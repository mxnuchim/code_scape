/**
 * JavaScript / TypeScript extraction from a tree-sitter syntax tree:
 * declarations (with line ranges), imports with their bindings, exports,
 * call sites with the enclosing symbol, and HTTP route registrations.
 */
import type { Node } from "web-tree-sitter";
import type { CallSite, CodeLanguage, CodeSymbol, ImportRecord, ParsedFile, RouteDecl, SymbolKind } from "./types";
import { HTTP_METHODS, docLine, lineRange, nextRouteFromPath, stringValue } from "./syntax";

const MAX_DEPTH = 1500;
const ROUTE_REGISTRARS = new Set(["get", "post", "put", "patch", "delete", "del", "all", "options", "head"]);

const FUNCTION_VALUES = new Set(["arrow_function", "function_expression", "function", "generator_function"]);

export function extractJs(path: string, language: CodeLanguage, root: Node): ParsedFile {
  const symbols: CodeSymbol[] = [];
  const imports: ImportRecord[] = [];
  const calls: CallSite[] = [];
  const routes: RouteDecl[] = [];
  const exports: Record<string, string> = {};
  const seen = new Set<string>();
  /** Declaration node id → its symbol, so bodies are walked with the right scope. */
  const declared = new Map<number, CodeSymbol>();

  const addSymbol = (
    name: string,
    qualifiedName: string,
    kind: SymbolKind,
    node: Node,
    exported: boolean,
    docNode?: Node,
  ): CodeSymbol => {
    let id = `${path}#${qualifiedName}`;
    // Overloads and redeclarations: keep ids unique and stable by suffixing the line.
    if (seen.has(id)) id = `${id}@${node.startPosition.row + 1}`;
    seen.add(id);
    const symbol: CodeSymbol = { id, name, qualifiedName, kind, path, range: lineRange(node), exported };
    const doc = docLine(docNode ?? node);
    if (doc) symbol.doc = doc;
    symbols.push(symbol);
    return symbol;
  };

  // ---- top-level declarations ------------------------------------------------
  const declare = (decl: Node, exported: boolean, isDefault: boolean, docNode: Node): CodeSymbol[] => {
    const out: CodeSymbol[] = [];
    switch (decl.type) {
      case "function_declaration":
      case "generator_function_declaration":
      case "function_signature": {
        const name = decl.childForFieldName("name")?.text;
        if (!name) break;
        const sym = addSymbol(name, name, "function", decl, exported, docNode);
        declared.set(decl.id, sym);
        out.push(sym);
        if (isDefault) exports.default = name;
        break;
      }
      case "class_declaration":
      case "abstract_class_declaration": {
        const name = decl.childForFieldName("name")?.text;
        if (!name) break;
        out.push(addSymbol(name, name, "class", decl, exported, docNode));
        if (isDefault) exports.default = name;
        break;
      }
      case "interface_declaration":
      case "type_alias_declaration":
      case "enum_declaration": {
        const name = decl.childForFieldName("name")?.text;
        if (!name) break;
        const kind: SymbolKind = decl.type === "interface_declaration" ? "interface" : decl.type === "enum_declaration" ? "enum" : "type";
        out.push(addSymbol(name, name, kind, decl, exported, docNode));
        break;
      }
      case "lexical_declaration":
      case "variable_declaration": {
        for (const d of decl.namedChildren) {
          if (d?.type !== "variable_declarator") continue;
          const nameNode = d.childForFieldName("name");
          if (nameNode?.type !== "identifier") continue;
          const value = d.childForFieldName("value");
          const isFn = value ? FUNCTION_VALUES.has(value.type) : false;
          const sym = addSymbol(nameNode.text, nameNode.text, isFn ? "function" : "variable", d, exported, docNode);
          if (isFn) declared.set(d.id, sym);
          if (value?.type === "new_expression") {
            const ctor = value.childForFieldName("constructor");
            if (ctor?.type === "identifier") sym.instanceOf = ctor.text;
          }
          out.push(sym);
        }
        break;
      }
    }
    for (const s of out) if (exported && !isDefault) exports[s.name] = s.qualifiedName;
    return out;
  };

  const handleExport = (node: Node) => {
    const source = node.childForFieldName("source");
    const decl = node.childForFieldName("declaration");
    const isDefault = node.children.some((c) => c?.type === "default");
    if (source) {
      // Re-export: export { a as b } from "x"; export * from "x"; export * as ns from "x"
      const spec = stringValue(source);
      if (spec === undefined) return;
      const rec: ImportRecord = { specifier: spec, line: node.startPosition.row + 1, kind: "reexport", typeOnly: hasTypeKeyword(node), bindings: [] };
      for (const c of node.namedChildren) {
        if (c?.type === "export_clause") {
          for (const s of c.namedChildren) {
            if (s?.type !== "export_specifier") continue;
            const name = s.childForFieldName("name")?.text;
            const alias = s.childForFieldName("alias")?.text;
            if (name) rec.bindings.push({ local: alias ?? name, imported: name });
          }
        } else if (c?.type === "namespace_export") {
          const id = c.namedChildren.find((n) => n?.type === "identifier");
          if (id) rec.bindings.push({ local: id.text, imported: "*" });
        }
      }
      if (rec.bindings.length === 0) rec.bindings.push({ local: "*", imported: "*" });
      imports.push(rec);
      return;
    }
    if (decl) {
      declare(decl, true, isDefault, node);
      return;
    }
    for (const c of node.namedChildren) {
      if (c?.type === "export_clause") {
        for (const s of c.namedChildren) {
          if (s?.type !== "export_specifier") continue;
          const name = s.childForFieldName("name")?.text;
          const alias = s.childForFieldName("alias")?.text;
          if (name) exports[alias ?? name] = name;
        }
      }
    }
    if (isDefault) {
      const value = node.childForFieldName("value") ?? node.namedChildren.find((c) => c && c.type !== "comment");
      if (!value) return;
      if (value.type === "identifier") exports.default = value.text;
      else if (FUNCTION_VALUES.has(value.type) || value.type === "class") {
        const name = value.childForFieldName("name")?.text ?? "default";
        const sym = addSymbol(name, name, value.type === "class" ? "class" : "function", value, true, node);
        if (value.type !== "class") declared.set(value.id, sym);
        exports.default = name;
      }
    }
  };

  // ---- imports ---------------------------------------------------------------
  const handleImport = (node: Node) => {
    const source = node.childForFieldName("source");
    const spec = source ? stringValue(source) : undefined;
    if (spec === undefined) return;
    const rec: ImportRecord = { specifier: spec, line: node.startPosition.row + 1, kind: "static", typeOnly: hasTypeKeyword(node), bindings: [] };
    const clause = node.namedChildren.find((c) => c?.type === "import_clause");
    for (const part of clause?.namedChildren ?? []) {
      if (!part) continue;
      if (part.type === "identifier") rec.bindings.push({ local: part.text, imported: "default" });
      else if (part.type === "namespace_import") {
        const id = part.namedChildren.find((n) => n?.type === "identifier");
        if (id) rec.bindings.push({ local: id.text, imported: "*" });
      } else if (part.type === "named_imports") {
        for (const s of part.namedChildren) {
          if (s?.type !== "import_specifier") continue;
          const name = s.childForFieldName("name")?.text;
          const alias = s.childForFieldName("alias")?.text;
          if (name) rec.bindings.push({ local: alias ?? name, imported: name });
        }
      }
    }
    imports.push(rec);
  };

  // `const x = require("y")`, `const { a, b: c } = require("y")`, `import("y")`
  const handleRequireOrDynamic = (call: Node, fn: Node): boolean => {
    const isRequire = fn.type === "identifier" && fn.text === "require";
    const isDynamic = fn.type === "import";
    if (!isRequire && !isDynamic) return false;
    const arg = call.childForFieldName("arguments")?.namedChildren[0];
    const spec = arg ? stringValue(arg) : undefined;
    if (spec === undefined) return true;
    const rec: ImportRecord = { specifier: spec, line: call.startPosition.row + 1, kind: isRequire ? "require" : "dynamic", typeOnly: false, bindings: [] };
    const declarator = call.parent?.type === "variable_declarator" ? call.parent : call.parent?.parent?.type === "variable_declarator" ? call.parent.parent : null;
    const target = declarator?.childForFieldName("name");
    if (isRequire && target?.type === "identifier") rec.bindings.push({ local: target.text, imported: "*" });
    else if (isRequire && target?.type === "object_pattern") {
      for (const p of target.namedChildren) {
        if (p?.type === "shorthand_property_identifier_pattern") rec.bindings.push({ local: p.text, imported: p.text });
        else if (p?.type === "pair_pattern") {
          const key = p.childForFieldName("key")?.text;
          const value = p.childForFieldName("value");
          if (key && value?.type === "identifier") rec.bindings.push({ local: value.text, imported: key });
        }
      }
    }
    imports.push(rec);
    return true;
  };

  // ---- calls and routes ------------------------------------------------------
  const calleeText = (fn: Node): string | undefined => {
    if (fn.type === "identifier") return fn.text;
    if (fn.type === "member_expression") {
      const prop = fn.childForFieldName("property");
      const obj = fn.childForFieldName("object");
      if (!prop || !obj) return undefined;
      if (obj.type === "identifier" || obj.type === "this") return `${obj.text}.${prop.text}`;
      if (obj.type === "member_expression") {
        const inner = calleeText(obj);
        return inner && inner.split(".").length < 3 ? `${inner}.${prop.text}` : undefined;
      }
    }
    return undefined;
  };

  const handleRoute = (call: Node, fn: Node): string | undefined => {
    if (fn.type !== "member_expression") return undefined;
    const method = fn.childForFieldName("property")?.text;
    if (!method || !ROUTE_REGISTRARS.has(method)) return undefined;
    const args = call.childForFieldName("arguments")?.namedChildren.filter((a): a is Node => !!a && a.type !== "comment") ?? [];
    if (args.length < 2) return undefined;
    const route = stringValue(args[0]);
    if (route === undefined || !route.startsWith("/")) return undefined;
    const handlerNode = args[args.length - 1];
    const decl: RouteDecl = {
      method: method === "del" ? "DELETE" : method.toUpperCase(),
      route,
      line: call.startPosition.row + 1,
      framework: "express-style",
    };
    let handlerScope: string | undefined;
    if (FUNCTION_VALUES.has(handlerNode.type)) {
      const sym = addSymbol(`${decl.method} ${route}`, `${decl.method} ${route}`, "handler", handlerNode, false);
      decl.handler = sym.id;
      handlerScope = sym.id;
    } else {
      const ref = calleeText(handlerNode);
      if (ref) decl.handlerRef = ref;
    }
    routes.push(decl);
    return handlerScope;
  };

  // ---- walk ------------------------------------------------------------------
  const walk = (node: Node, enclosing: string | undefined, className: string | undefined, depth: number) => {
    if (depth > MAX_DEPTH) return;
    let scope = enclosing;

    switch (node.type) {
      case "import_statement":
        handleImport(node);
        return;
      case "method_definition":
      case "method_signature":
      case "abstract_method_signature": {
        const name = node.childForFieldName("name")?.text;
        if (name && className) scope = addSymbol(name, `${className}.${name}`, "method", node, false).id;
        break;
      }
      case "public_field_definition":
      case "field_definition": {
        const value = node.childForFieldName("value");
        const name = (node.childForFieldName("name") ?? node.childForFieldName("property"))?.text;
        if (name && className && value && FUNCTION_VALUES.has(value.type)) {
          scope = addSymbol(name, `${className}.${name}`, "method", node, false).id;
        }
        break;
      }
      case "class_declaration":
      case "abstract_class_declaration":
      case "class": {
        const name = node.childForFieldName("name")?.text;
        const body = node.childForFieldName("body");
        if (body) for (const c of body.namedChildren) if (c) walk(c, scope, name ?? className, depth + 1);
        return;
      }
      case "call_expression": {
        const fn = node.childForFieldName("function");
        if (!fn || handleRequireOrDynamic(node, fn)) break;
        const callee = calleeText(fn);
        if (callee) calls.push({ callee, line: node.startPosition.row + 1, ...(enclosing ? { enclosing } : {}) });
        const handlerScope = handleRoute(node, fn);
        if (handlerScope) {
          // The inline handler (last argument) gets its own scope; everything else keeps ours.
          walk(fn, scope, className, depth + 1);
          const args = node.childForFieldName("arguments")?.namedChildren.filter((a): a is Node => !!a) ?? [];
          args.forEach((a, i) => walk(a, i === args.length - 1 ? handlerScope : scope, className, depth + 1));
          return;
        }
        break;
      }
      case "jsx_opening_element":
      case "jsx_self_closing_element": {
        // Rendering a component is a reference to it, like a call: <UserCard /> → UserCard.
        const nameNode = node.childForFieldName("name");
        const name = nameNode?.text;
        if (name && /^[A-Z][\w]*(\.[A-Z]?\w+)?$/.test(name)) {
          calls.push({ callee: name, line: node.startPosition.row + 1, ...(enclosing ? { enclosing } : {}) });
        }
        break;
      }
      case "new_expression": {
        const ctor = node.childForFieldName("constructor");
        if (ctor?.type === "identifier") calls.push({ callee: `new:${ctor.text}`, line: node.startPosition.row + 1, ...(enclosing ? { enclosing } : {}) });
        break;
      }
    }
    walkChildren(node, scope, className, depth + 1);
  };

  const walkChildren = (node: Node, scope: string | undefined, className: string | undefined, depth: number) => {
    for (const child of node.namedChildren) if (child) walk(child, scope, className, depth);
  };

  // Top level: declarations first (so scopes exist), then walk bodies.
  for (const node of root.namedChildren) {
    if (!node) continue;
    if (node.type === "export_statement") handleExport(node);
    else if (node.type !== "import_statement" && node.type !== "comment") declare(node, false, false, node);
  }

  for (const node of root.namedChildren) {
    if (!node) continue;
    if (node.type === "import_statement") {
      handleImport(node);
      continue;
    }
    if (node.type === "export_statement" && node.childForFieldName("source")) continue;
    const decl = node.type === "export_statement" ? (node.childForFieldName("declaration") ?? node.childForFieldName("value") ?? node) : node;
    walkTopLevel(decl);
  }

  function walkTopLevel(decl: Node) {
    if (decl.type === "lexical_declaration" || decl.type === "variable_declaration") {
      for (const d of decl.namedChildren) {
        if (d?.type !== "variable_declarator") continue;
        const value = d.childForFieldName("value");
        if (value) walk(value, declared.get(d.id)?.id, undefined, 1);
      }
      return;
    }
    const sym = declared.get(decl.id);
    const body = decl.childForFieldName("body");
    if (sym && body) walk(body, sym.id, undefined, 1);
    else walk(decl, undefined, undefined, 1);
  }

  // Next.js conventions: route handlers by file path and exported method names.
  const nextRoute = nextRouteFromPath(path);
  if (nextRoute) {
    for (const s of symbols) {
      if (nextRoute.kind === "app" && s.exported && HTTP_METHODS.has(s.name)) {
        routes.push({ method: s.name, route: nextRoute.route, line: s.range.startLine, framework: "next-app-router", handler: s.id });
      }
    }
    if (nextRoute.kind === "page" && exports.default) {
      const target = symbols.find((s) => s.qualifiedName === exports.default);
      if (target) routes.push({ method: "PAGE", route: nextRoute.route, line: target.range.startLine, framework: "next-app-page", handler: target.id });
    }
    if (nextRoute.kind === "pages" && exports.default) {
      const target = symbols.find((s) => s.qualifiedName === exports.default);
      routes.push({
        method: "ANY",
        route: nextRoute.route,
        line: target?.range.startLine ?? 1,
        framework: "next-pages-api",
        ...(target ? { handler: target.id } : {}),
      });
    }
  }


  return {
    path,
    language,
    parser: "tree-sitter",
    lineCount: 0,
    symbols,
    imports: imports.sort((a, b) => a.line - b.line),
    calls,
    routes: routes.sort((a, b) => a.line - b.line),
    exports,
  };
}

function hasTypeKeyword(node: Node): boolean {
  // `import type { X }` / `export type { X } from` — the keyword is an anonymous child.
  return node.children.some((c) => c?.type === "type" || (c?.type === "import_clause" && c.text.startsWith("type ")));
}
