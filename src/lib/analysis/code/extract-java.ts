/**
 * Java extraction from a tree-sitter syntax tree: classes, interfaces, enums
 * and records (nested ones as `Outer.Inner`), methods and constructors, typed
 * fields, imports (single-type, on-demand and static), call sites, Spring MVC
 * route mappings, and `public static void main`.
 *
 * The receiver type of `x.m()` is recorded only when the source declares it:
 * a parameter, a local (`var x = new T()` included) or a field of the
 * enclosing class. That is what makes constructor-injected Spring services
 * traceable without guessing.
 */
import type { Node } from "web-tree-sitter";
import type { CallSite, CodeSymbol, ImportRecord, ParsedFile, RouteDecl, SymbolKind } from "./types";
import { docLine, lineRange, stringValue } from "./syntax";

const MAX_DEPTH = 1500;
const MAPPINGS: Record<string, string | undefined> = {
  GetMapping: "GET",
  PostMapping: "POST",
  PutMapping: "PUT",
  PatchMapping: "PATCH",
  DeleteMapping: "DELETE",
  RequestMapping: undefined,
};
const TYPE_DECLS: Record<string, SymbolKind> = {
  class_declaration: "class",
  interface_declaration: "interface",
  enum_declaration: "enum",
  record_declaration: "class",
  annotation_type_declaration: "interface",
};

/** The class a declared type names: `List<User>` → `List`, `a.b.C` → `a.b.C`, primitives → undefined. */
export function javaTypeName(node: Node | null | undefined): string | undefined {
  if (!node) return undefined;
  if (node.type === "type_identifier") return node.text === "var" ? undefined : node.text;
  if (node.type === "scoped_type_identifier") return node.text.replace(/\s+/g, "");
  if (node.type === "generic_type") return javaTypeName(node.namedChildren.find((c) => c?.type === "type_identifier" || c?.type === "scoped_type_identifier"));
  return undefined;
}

function modifiersOf(node: Node): Node | undefined {
  return node.namedChildren.find((c): c is Node => c?.type === "modifiers");
}

function hasModifier(node: Node, word: string): boolean {
  const mods = modifiersOf(node);
  return !!mods && mods.children.some((c) => c?.text === word);
}

interface Annotation {
  name: string;
  /** Unnamed argument or `value =` / `path =`. */
  path?: string;
  /** `method = RequestMethod.X`. */
  method?: string;
  line: number;
}

function annotationsOf(node: Node): Annotation[] {
  const out: Annotation[] = [];
  for (const a of modifiersOf(node)?.namedChildren ?? []) {
    if (a?.type !== "annotation" && a?.type !== "marker_annotation") continue;
    const nameNode = a.childForFieldName("name");
    if (!nameNode) continue;
    const ann: Annotation = { name: nameNode.text.slice(nameNode.text.lastIndexOf(".") + 1), line: a.startPosition.row + 1 };
    for (const arg of a.childForFieldName("arguments")?.namedChildren ?? []) {
      if (!arg) continue;
      if (arg.type === "element_value_pair") {
        const key = arg.childForFieldName("key")?.text;
        const value = arg.childForFieldName("value");
        if (!value) continue;
        if ((key === "value" || key === "path") && ann.path === undefined) ann.path = firstString(value);
        if (key === "method") ann.method = (value.type === "element_value_array_initializer" ? value.namedChildren[0] : value)?.text.split(".").pop();
      } else if (ann.path === undefined) ann.path = firstString(arg);
    }
    out.push(ann);
  }
  return out;
}

/** A string literal, or the first one in `{"/a", "/b"}`. */
function firstString(node: Node): string | undefined {
  if (node.type === "element_value_array_initializer") {
    const first = node.namedChildren[0];
    return first ? stringValue(first) : undefined;
  }
  return stringValue(node);
}

function joinRoute(prefix: string, path: string): string {
  const joined = `${prefix.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`.replace(/\/+$/, "");
  return joined.startsWith("/") ? joined || "/" : `/${joined}`;
}

export function extractJava(path: string, root: Node): ParsedFile {
  const symbols: CodeSymbol[] = [];
  const imports: ImportRecord[] = [];
  const calls: CallSite[] = [];
  const routes: RouteDecl[] = [];
  const seen = new Set<string>();
  let javaPackage: string | undefined;
  let mainAt: number | undefined;

  const addSymbol = (name: string, qualifiedName: string, kind: SymbolKind, node: Node, exported: boolean): CodeSymbol => {
    let id = `${path}#${qualifiedName}`;
    if (seen.has(id)) id = `${id}@${node.startPosition.row + 1}`;
    seen.add(id);
    const symbol: CodeSymbol = { id, name, qualifiedName, kind, path, range: lineRange(node), exported };
    const doc = docLine(node);
    if (doc) symbol.doc = doc;
    symbols.push(symbol);
    return symbol;
  };

  /** Parameters and locals of one method (null when declared twice with different types). */
  const scopeOf = (method: Node): Map<string, string | null> => {
    const scope = new Map<string, string | null>();
    const bind = (name: string | undefined, type: string | undefined) => {
      if (!name || !type) return;
      scope.set(name, scope.has(name) && scope.get(name) !== type ? null : type);
    };
    for (const p of method.childForFieldName("parameters")?.namedChildren ?? []) {
      if (p?.type === "formal_parameter" || p?.type === "spread_parameter") bind(p.childForFieldName("name")?.text, javaTypeName(p.childForFieldName("type")));
    }
    const visit = (node: Node, depth: number) => {
      if (depth > MAX_DEPTH || node.type === "class_body" || node.type === "lambda_expression") return;
      if (node.type === "local_variable_declaration") {
        const declared = javaTypeName(node.childForFieldName("type"));
        for (const d of node.namedChildren) {
          if (d?.type !== "variable_declarator") continue;
          const value = d.childForFieldName("value");
          const created = value?.type === "object_creation_expression" ? javaTypeName(value.childForFieldName("type")) : undefined;
          bind(d.childForFieldName("name")?.text, declared ?? created);
        }
      } else if (node.type === "enhanced_for_statement") {
        bind(node.childForFieldName("name")?.text, javaTypeName(node.childForFieldName("type")));
      }
      for (const c of node.namedChildren) if (c) visit(c, depth + 1);
    };
    const body = method.childForFieldName("body");
    if (body) visit(body, 1);
    return scope;
  };

  interface Ctx {
    id: string;
    scope: Map<string, string | null>;
    fields: Map<string, string>;
  }

  const receiverType = (object: Node, ctx: Ctx | undefined): string | undefined => {
    if (!ctx) return undefined;
    if (object.type === "identifier") {
      if (ctx.scope.has(object.text)) return ctx.scope.get(object.text) ?? undefined;
      return ctx.fields.get(object.text);
    }
    if (object.type === "field_access" && object.childForFieldName("object")?.type === "this") {
      const field = object.childForFieldName("field")?.text;
      return field ? ctx.fields.get(field) : undefined;
    }
    return undefined;
  };

  const walk = (node: Node, ctx: Ctx | undefined, depth: number) => {
    if (depth > MAX_DEPTH) return;
    if (node.type === "class_body" || node.type === "interface_body" || node.type === "enum_body") return; // anonymous/local classes
    if (node.type === "method_invocation") {
      const name = node.childForFieldName("name")?.text;
      const object = node.childForFieldName("object");
      const argCount = node.childForFieldName("arguments")?.namedChildCount ?? 0;
      let callee: string | undefined;
      let type: string | undefined;
      if (name && !object) callee = name;
      else if (name && object) {
        if (object.type === "identifier" || object.type === "this" || object.type === "super") callee = `${object.text}.${name}`;
        else if (object.type === "field_access" && object.childForFieldName("object")?.type === "this") callee = `this.${object.childForFieldName("field")?.text}.${name}`;
        else if (object.type === "scoped_identifier" || object.type === "field_access") callee = `${object.text.replace(/\s+/g, "")}.${name}`;
        type = object.type === "this" ? undefined : receiverType(object, ctx);
      }
      if (callee) calls.push({ callee, line: node.startPosition.row + 1, argCount, ...(type ? { receiverType: type } : {}), ...(ctx ? { enclosing: ctx.id } : {}) });
    } else if (node.type === "object_creation_expression") {
      const type = javaTypeName(node.childForFieldName("type"));
      const argCount = node.childForFieldName("arguments")?.namedChildCount ?? 0;
      if (type) calls.push({ callee: `new:${type}`, line: node.startPosition.row + 1, argCount, ...(ctx ? { enclosing: ctx.id } : {}) });
    }
    for (const c of node.namedChildren) if (c) walk(c, ctx, depth + 1);
  };

  const visitType = (node: Node, prefix: string, outerPublic: boolean) => {
    const name = node.childForFieldName("name")?.text;
    const body = node.childForFieldName("body");
    if (!name) return;
    const qualified = `${prefix}${name}`;
    const exported = hasModifier(node, "public") || (prefix !== "" && outerPublic && node.type === "interface_declaration");
    addSymbol(name, qualified, TYPE_DECLS[node.type], node, exported);
    if (!body) return;

    const classRoute = annotationsOf(node).find((a) => a.name === "RequestMapping")?.path ?? "";
    const fields = new Map<string, string>();
    for (const m of body.namedChildren) {
      if (m?.type !== "field_declaration" && m?.type !== "constant_declaration") continue;
      const type = javaTypeName(m.childForFieldName("type"));
      for (const d of m.namedChildren) {
        if (d?.type !== "variable_declarator") continue;
        const field = d.childForFieldName("name")?.text;
        if (!field) continue;
        if (type) fields.set(field, type);
        const sym = addSymbol(field, `${qualified}.${field}`, "variable", m, hasModifier(m, "public"));
        if (type) sym.instanceOf = type;
      }
    }
    // Record components are fields too.
    for (const p of node.childForFieldName("parameters")?.namedChildren ?? []) {
      const field = p?.childForFieldName("name")?.text;
      const type = javaTypeName(p?.childForFieldName("type"));
      if (field && type) fields.set(field, type);
    }

    for (const m of body.namedChildren) {
      if (!m) continue;
      if (m.type in TYPE_DECLS) {
        visitType(m, `${qualified}.`, exported);
        continue;
      }
      if (m.type === "enum_body_declarations") {
        for (const inner of m.namedChildren) if (inner?.type === "method_declaration") visitMethod(inner, qualified, fields, "");
        continue;
      }
      if (m.type === "method_declaration" || m.type === "constructor_declaration" || m.type === "compact_constructor_declaration") {
        visitMethod(m, qualified, fields, classRoute, node.type === "interface_declaration");
      } else if (m.type === "field_declaration" || m.type === "static_initializer") {
        walk(m, undefined, 1);
      }
    }
  };

  const visitMethod = (m: Node, qualified: string, fields: Map<string, string>, classRoute: string, inInterface = false) => {
    const isCtor = m.type !== "method_declaration";
    const mName = isCtor ? qualified.slice(qualified.lastIndexOf(".") + 1) : m.childForFieldName("name")?.text;
    if (!mName) return;
    const sym = addSymbol(mName, `${qualified}.${mName}`, "method", m, inInterface || hasModifier(m, "public"));
    const params = m.childForFieldName("parameters")?.namedChildren.filter((p) => p?.type === "formal_parameter" || p?.type === "spread_parameter") ?? [];
    sym.params = params.length;
    if (params.some((p) => p?.type === "spread_parameter")) sym.params = -1; // varargs: any count
    if (mName === "main" && hasModifier(m, "static") && hasModifier(m, "public") && params.length === 1) mainAt = sym.range.startLine;

    for (const ann of annotationsOf(m)) {
      if (!(ann.name in MAPPINGS)) continue;
      const method = MAPPINGS[ann.name] ?? ann.method?.toUpperCase() ?? "ANY";
      routes.push({ method, route: joinRoute(classRoute, ann.path ?? ""), line: ann.line, framework: "spring", handler: sym.id });
    }
    const body = m.childForFieldName("body");
    if (body) walk(body, { id: sym.id, scope: scopeOf(m), fields }, 1);
  };

  for (const node of root.namedChildren) {
    if (!node) continue;
    if (node.type === "package_declaration") {
      javaPackage = node.namedChildren.find((c) => c?.type === "scoped_identifier" || c?.type === "identifier")?.text.replace(/\s+/g, "");
    } else if (node.type === "import_declaration") {
      const target = node.namedChildren.find((c) => c?.type === "scoped_identifier" || c?.type === "identifier");
      if (!target) continue;
      const name = target.text.replace(/\s+/g, "");
      const isStatic = node.children.some((c) => c?.type === "static");
      const wildcard = node.namedChildren.some((c) => c?.type === "asterisk");
      const segs = name.split(".");
      const local = wildcard ? "*" : segs[segs.length - 1];
      imports.push({
        specifier: wildcard ? `${name}.*` : name,
        line: node.startPosition.row + 1,
        kind: "static",
        typeOnly: false,
        // Static members are looked up as `Class.member`; types by their simple name.
        bindings: [{ local, imported: wildcard ? "*" : isStatic ? segs.slice(-2).join(".") : local }],
        java: { static: isStatic, wildcard },
      });
    } else if (node.type in TYPE_DECLS) {
      visitType(node, "", false);
    }
  }

  return {
    path,
    language: "java",
    parser: "tree-sitter",
    lineCount: 0,
    symbols,
    imports,
    calls,
    routes,
    exports: {},
    ...(javaPackage ? { javaPackage } : {}),
    ...(mainAt ? { mainAt } : {}),
  };
}
