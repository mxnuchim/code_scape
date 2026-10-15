/**
 * Go extraction from a tree-sitter syntax tree: functions, methods and type
 * declarations, imports, call sites, net/http and router-style route
 * registrations, and `func main` in package main.
 */
import type { Node } from "web-tree-sitter";
import type { CallSite, CodeSymbol, ImportRecord, ParsedFile, RouteDecl, SymbolKind } from "./types";
import { docLine, lineRange, stringValue } from "./syntax";

const MAX_DEPTH = 1500;
const ROUTE_FUNCS: Record<string, string> = {
  HandleFunc: "ANY",
  Handle: "ANY",
  GET: "GET",
  POST: "POST",
  PUT: "PUT",
  PATCH: "PATCH",
  DELETE: "DELETE",
  Get: "GET",
  Post: "POST",
  Put: "PUT",
  Patch: "PATCH",
  Delete: "DELETE",
};

const isExported = (name: string) => /^[A-Z]/.test(name);

export function extractGo(path: string, root: Node): ParsedFile {
  const symbols: CodeSymbol[] = [];
  const imports: ImportRecord[] = [];
  const calls: CallSite[] = [];
  const routes: RouteDecl[] = [];
  const seen = new Set<string>();
  let goPackage: string | undefined;
  let mainAt: number | undefined;

  const addSymbol = (name: string, qualifiedName: string, kind: SymbolKind, node: Node): CodeSymbol => {
    let id = `${path}#${qualifiedName}`;
    if (seen.has(id)) id = `${id}@${node.startPosition.row + 1}`;
    seen.add(id);
    const symbol: CodeSymbol = { id, name, qualifiedName, kind, path, range: lineRange(node), exported: isExported(name) };
    const doc = docLine(node);
    if (doc) symbol.doc = doc;
    symbols.push(symbol);
    return symbol;
  };

  const calleeText = (fn: Node): string | undefined => {
    if (fn.type === "identifier") return fn.text;
    if (fn.type === "selector_expression") {
      const operand = fn.childForFieldName("operand");
      const field = fn.childForFieldName("field")?.text;
      if (operand?.type === "identifier" && field) return `${operand.text}.${field}`;
    }
    return undefined;
  };

  const walk = (node: Node, enclosing: string | undefined, depth: number) => {
    if (depth > MAX_DEPTH) return;
    if (node.type === "call_expression") {
      const fn = node.childForFieldName("function");
      const callee = fn ? calleeText(fn) : undefined;
      if (callee) calls.push({ callee, line: node.startPosition.row + 1, ...(enclosing ? { enclosing } : {}) });
      const field = fn?.type === "selector_expression" ? fn.childForFieldName("field")?.text : undefined;
      const args = node.childForFieldName("arguments")?.namedChildren.filter((a): a is Node => !!a) ?? [];
      const route = field && field in ROUTE_FUNCS && args.length >= 2 ? stringValue(args[0]) : undefined;
      if (field && route?.startsWith("/")) {
        const decl: RouteDecl = { method: ROUTE_FUNCS[field], route, line: node.startPosition.row + 1, framework: "go-http" };
        const handler = args[args.length - 1];
        if (handler.type === "func_literal") {
          const sym = addSymbol(`${decl.method} ${route}`, `${decl.method} ${route}`, "handler", handler);
          decl.handler = sym.id;
          routes.push(decl);
          for (const a of args.slice(0, -1)) walk(a, enclosing, depth + 1);
          walk(handler, sym.id, depth + 1);
          if (fn) walk(fn, enclosing, depth + 1);
          return;
        }
        const ref = calleeText(handler);
        if (ref) decl.handlerRef = ref;
        routes.push(decl);
      }
    }
    for (const c of node.namedChildren) if (c) walk(c, enclosing, depth + 1);
  };

  for (const node of root.namedChildren) {
    if (!node) continue;
    switch (node.type) {
      case "package_clause":
        goPackage = node.namedChildren[0]?.text;
        break;
      case "import_declaration": {
        const specs: Node[] = [];
        for (const c of node.namedChildren) {
          if (c?.type === "import_spec") specs.push(c);
          else if (c?.type === "import_spec_list") for (const s of c.namedChildren) if (s?.type === "import_spec") specs.push(s);
        }
        for (const spec of specs) {
          const pathNode = spec.childForFieldName("path");
          const importPath = pathNode ? stringValue(pathNode) : undefined;
          if (!importPath) continue;
          const alias = spec.childForFieldName("name")?.text;
          const local = alias && alias !== "_" && alias !== "." ? alias : importPath.slice(importPath.lastIndexOf("/") + 1);
          imports.push({
            specifier: importPath,
            line: spec.startPosition.row + 1,
            kind: "static",
            typeOnly: false,
            bindings: [{ local, imported: "*" }],
          });
        }
        break;
      }
      case "function_declaration": {
        const name = node.childForFieldName("name")?.text;
        if (!name) break;
        const sym = addSymbol(name, name, "function", node);
        if (name === "main" && goPackage === "main") mainAt = sym.range.startLine;
        const body = node.childForFieldName("body");
        if (body) walk(body, sym.id, 1);
        break;
      }
      case "method_declaration": {
        const name = node.childForFieldName("name")?.text;
        if (!name) break;
        const receiver = node.childForFieldName("receiver")?.text ?? "";
        const recvType = /\*?\s*([A-Za-z_]\w*)\s*(?:\[[^\]]*\])?\s*\)\s*$/.exec(receiver)?.[1];
        const sym = addSymbol(name, recvType ? `${recvType}.${name}` : name, "method", node);
        const body = node.childForFieldName("body");
        if (body) walk(body, sym.id, 1);
        break;
      }
      case "type_declaration": {
        for (const spec of node.namedChildren) {
          if (spec?.type !== "type_spec" && spec?.type !== "type_alias") continue;
          const name = spec.childForFieldName("name")?.text;
          const type = spec.childForFieldName("type");
          if (!name) continue;
          addSymbol(name, name, type?.type === "interface_type" ? "interface" : type?.type === "struct_type" ? "class" : "type", spec);
        }
        break;
      }
      default:
        walk(node, undefined, 1);
    }
  }

  return {
    path,
    language: "go",
    parser: "tree-sitter",
    lineCount: 0,
    symbols,
    imports,
    calls,
    routes,
    exports: {},
    ...(goPackage ? { goPackage } : {}),
    ...(mainAt ? { mainAt } : {}),
  };
}
