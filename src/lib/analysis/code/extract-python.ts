/**
 * Python extraction from a tree-sitter syntax tree: functions, classes and
 * methods with docstrings, imports with bindings, call sites, Flask/FastAPI
 * style route decorators and the `if __name__ == "__main__":` guard.
 */
import type { Node } from "web-tree-sitter";
import type { CallSite, CodeSymbol, ImportRecord, ParsedFile, RouteDecl, SymbolKind } from "./types";
import { firstMeaningfulLine, lineRange, stringValue } from "./syntax";

const MAX_DEPTH = 1500;
const ROUTE_DECORATORS: Record<string, string | null> = {
  route: null,
  api_route: null,
  get: "GET",
  post: "POST",
  put: "PUT",
  patch: "PATCH",
  delete: "DELETE",
};

export function extractPython(path: string, root: Node): ParsedFile {
  const symbols: CodeSymbol[] = [];
  const imports: ImportRecord[] = [];
  const calls: CallSite[] = [];
  const routes: RouteDecl[] = [];
  const seen = new Set<string>();
  let mainAt: number | undefined;

  const addSymbol = (name: string, qualifiedName: string, kind: SymbolKind, node: Node, exported: boolean): CodeSymbol => {
    let id = `${path}#${qualifiedName}`;
    if (seen.has(id)) id = `${id}@${node.startPosition.row + 1}`;
    seen.add(id);
    const symbol: CodeSymbol = { id, name, qualifiedName, kind, path, range: lineRange(node), exported };
    const doc = docstring(node);
    if (doc) symbol.doc = doc;
    symbols.push(symbol);
    return symbol;
  };

  const handleImport = (node: Node) => {
    const line = node.startPosition.row + 1;
    if (node.type === "import_statement") {
      for (const c of node.namedChildren) {
        if (!c) continue;
        const dotted = c.type === "aliased_import" ? c.childForFieldName("name") : c.type === "dotted_name" ? c : null;
        if (!dotted) continue;
        const alias = c.type === "aliased_import" ? c.childForFieldName("alias")?.text : undefined;
        const dottedName = dotted.text;
        imports.push({
          specifier: dottedName,
          line,
          kind: "static",
          typeOnly: false,
          // `import a.b` binds `a`; `import a.b as c` binds `c` to a.b.
          bindings: [{ local: alias ?? dottedName.split(".")[0], imported: "*" }],
          python: { level: 0, module: dottedName, names: [] },
        });
      }
      return;
    }
    // import_from_statement
    const moduleNode = node.childForFieldName("module_name");
    if (!moduleNode) return;
    let level = 0;
    let modulePath = moduleNode.text;
    if (moduleNode.type === "relative_import") {
      const prefix = moduleNode.namedChildren.find((n) => n?.type === "import_prefix");
      level = prefix?.text.length ?? 0;
      modulePath = moduleNode.namedChildren.find((n) => n?.type === "dotted_name")?.text ?? "";
    }
    const bindings: ImportRecord["bindings"] = [];
    const names: string[] = [];
    for (const c of node.childrenForFieldName("name")) {
      if (!c) continue;
      if (c.type === "aliased_import") {
        const name = c.childForFieldName("name")?.text;
        const alias = c.childForFieldName("alias")?.text;
        if (name) {
          bindings.push({ local: alias ?? name, imported: name });
          names.push(name);
        }
      } else if (c.type === "dotted_name") {
        bindings.push({ local: c.text, imported: c.text });
        names.push(c.text);
      }
    }
    if (node.namedChildren.some((n) => n?.type === "wildcard_import")) bindings.push({ local: "*", imported: "*" });
    imports.push({
      specifier: `${".".repeat(level)}${modulePath}`,
      line,
      kind: "static",
      typeOnly: false,
      bindings,
      python: { level, module: modulePath, names: names.filter((n) => /^\w+$/.test(n)) },
    });
  };

  const calleeText = (fn: Node): string | undefined => {
    if (fn.type === "identifier") return fn.text;
    if (fn.type === "attribute") {
      const obj = fn.childForFieldName("object");
      const attr = fn.childForFieldName("attribute")?.text;
      if (!obj || !attr) return undefined;
      if (obj.type === "identifier") return `${obj.text}.${attr}`;
      if (obj.type === "attribute") {
        const inner = calleeText(obj);
        return inner && inner.split(".").length < 3 ? `${inner}.${attr}` : undefined;
      }
    }
    return undefined;
  };

  const routeFromDecorators = (decorated: Node, handler: CodeSymbol) => {
    for (const dec of decorated.namedChildren) {
      if (dec?.type !== "decorator") continue;
      const call = dec.namedChildren.find((n) => n?.type === "call");
      const fn = call?.childForFieldName("function");
      if (!call || fn?.type !== "attribute") continue;
      const name = fn.childForFieldName("attribute")?.text ?? "";
      if (!(name in ROUTE_DECORATORS)) continue;
      const args = call.childForFieldName("arguments")?.namedChildren ?? [];
      const first = args[0];
      const route = first ? stringValue(first) : undefined;
      if (route === undefined || !route.startsWith("/")) continue;
      let methods = ROUTE_DECORATORS[name] ? [ROUTE_DECORATORS[name]!] : ["GET"];
      for (const a of args) {
        if (a?.type !== "keyword_argument" || a.childForFieldName("name")?.text !== "methods") continue;
        const list = a.childForFieldName("value");
        const found = (list?.namedChildren ?? []).map((n) => (n ? stringValue(n) : undefined)).filter((m): m is string => !!m);
        if (found.length) methods = found.map((m) => m.toUpperCase());
      }
      for (const method of methods) {
        routes.push({ method, route, line: dec.startPosition.row + 1, framework: "flask-style", handler: handler.id });
      }
    }
  };

  const walk = (node: Node, enclosing: string | undefined, className: string | undefined, depth: number) => {
    if (depth > MAX_DEPTH) return;
    switch (node.type) {
      case "import_statement":
      case "import_from_statement":
        handleImport(node);
        return;
      case "decorated_definition": {
        const def = node.childForFieldName("definition");
        if (!def) return;
        const sym = define(def, enclosing, className, depth);
        if (sym && (sym.kind === "function" || sym.kind === "method")) routeFromDecorators(node, sym);
        // Decorator expressions are calls too.
        for (const c of node.namedChildren) if (c?.type === "decorator") walk(c, enclosing, className, depth + 1);
        return;
      }
      case "function_definition":
      case "class_definition":
        define(node, enclosing, className, depth);
        return;
      case "call": {
        const fn = node.childForFieldName("function");
        const callee = fn ? calleeText(fn) : undefined;
        if (callee) calls.push({ callee, line: node.startPosition.row + 1, ...(enclosing ? { enclosing } : {}) });
        break;
      }
      case "if_statement": {
        const cond = node.childForFieldName("condition")?.text.replace(/\s+/g, "") ?? "";
        if (depth <= 2 && /__name__==["']__main__["']|["']__main__["']==__name__/.test(cond)) mainAt = node.startPosition.row + 1;
        break;
      }
    }
    for (const c of node.namedChildren) if (c) walk(c, enclosing, className, depth + 1);
  };

  /** Record a function/class definition and walk its body in its own scope. */
  const define = (def: Node, enclosing: string | undefined, className: string | undefined, depth: number): CodeSymbol | undefined => {
    const name = def.childForFieldName("name")?.text;
    const body = def.childForFieldName("body");
    if (!name) return undefined;
    const topLevel = enclosing === undefined && className === undefined;
    let sym: CodeSymbol | undefined;
    if (def.type === "class_definition") {
      if (topLevel) sym = addSymbol(name, name, "class", def, !name.startsWith("_"));
      if (body) for (const c of body.namedChildren) if (c) walk(c, enclosing, name, depth + 1);
      return sym;
    }
    if (className && enclosing === undefined) sym = addSymbol(name, `${className}.${name}`, "method", def, !name.startsWith("_"));
    else if (topLevel) sym = addSymbol(name, name, "function", def, !name.startsWith("_"));
    const params = def.childForFieldName("parameters");
    if (params) walk(params, enclosing, className, depth + 1);
    if (body) for (const c of body.namedChildren) if (c) walk(c, sym?.id ?? enclosing, className, depth + 1);
    return sym;
  };

  for (const c of root.namedChildren) if (c) walk(c, undefined, undefined, 1);

  return {
    path,
    language: "python",
    parser: "tree-sitter",
    lineCount: 0,
    symbols,
    imports,
    calls,
    routes,
    exports: {},
    ...(mainAt ? { mainAt } : {}),
  };
}

function docstring(def: Node): string | undefined {
  const body = def.childForFieldName("body");
  const first = body?.namedChildren[0];
  if (first?.type !== "expression_statement") return undefined;
  const str = first.namedChildren[0];
  if (str?.type !== "string") return undefined;
  return firstMeaningfulLine(stringValue(str) ?? "");
}
