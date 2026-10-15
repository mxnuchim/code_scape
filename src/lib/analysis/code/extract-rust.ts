/**
 * Rust extraction from a tree-sitter syntax tree: functions, structs, enums,
 * traits and `impl` methods, `use` trees and `mod` declarations, call sites,
 * route registrations (actix/rocket attribute macros, axum `.route()`), and
 * `fn main` in a binary crate root.
 *
 * Receiver types for `x.m()` are recorded only when the source declares them:
 * a typed parameter or `let`, a struct literal, or a field of the `impl` type's
 * struct in this file. Nothing is inferred from a constructor's name.
 */
import type { Node } from "web-tree-sitter";
import type { CallSite, CodeSymbol, ImportRecord, ParsedFile, RouteDecl, SymbolKind } from "./types";
import { docLine, lineRange, stringValue } from "./syntax";

const MAX_DEPTH = 1500;
const HTTP_ATTRS = new Set(["get", "post", "put", "patch", "delete", "head", "options"]);
/** Smart pointers and extractors whose methods are reached through `Deref`. */
const DEREF_WRAPPERS = new Set(["Arc", "Rc", "Box", "State", "Data", "Extension", "Json", "Path", "Query", "Form"]);

const lastSegment = (path: string) => {
  const at = path.lastIndexOf("::");
  return at < 0 ? path : path.slice(at + 2);
};

/** The type a declaration names, unwrapping `&T`, `Arc<T>`, `State<T>` and similar. */
export function rustTypeName(node: Node | null | undefined): string | undefined {
  if (!node) return undefined;
  switch (node.type) {
    case "reference_type":
      return rustTypeName(node.childForFieldName("type"));
    case "generic_type": {
      const outer = node.childForFieldName("type");
      const name = outer ? rustTypeName(outer) : undefined;
      if (name && DEREF_WRAPPERS.has(lastSegment(name))) {
        const arg = node.childForFieldName("type_arguments")?.namedChildren.find((c) => c && c.type !== "lifetime");
        return rustTypeName(arg);
      }
      return name;
    }
    case "type_identifier":
      return node.text;
    case "scoped_type_identifier":
      return node.text.replace(/\s+/g, "");
    default:
      return undefined;
  }
}

/** Names bound by a parameter or `let` pattern: `x`, `mut x`, `State(x)`, `Json(x)`. */
function patternName(node: Node | null | undefined): string | undefined {
  if (!node) return undefined;
  if (node.type === "identifier") return node.text;
  if (node.type === "mut_pattern" || node.type === "ref_pattern") return patternName(node.namedChildren.find((c) => c?.type === "identifier"));
  if (node.type === "tuple_struct_pattern") {
    const typeId = node.childForFieldName("type")?.id;
    const inner = node.namedChildren.filter((c): c is Node => !!c && c.id !== typeId);
    return inner.length === 1 ? patternName(inner[0]) : undefined;
  }
  return undefined;
}

interface UseLeaf {
  path: string[];
  alias?: string;
  glob: boolean;
}

/** Flatten a `use` tree into one leaf per imported name. */
function flattenUse(node: Node, prefix: string[], out: UseLeaf[]) {
  switch (node.type) {
    case "identifier":
    case "crate":
    case "self":
    case "super":
    case "scoped_identifier":
      out.push({ path: [...prefix, ...node.text.replace(/\s+/g, "").split("::").filter(Boolean)], glob: false });
      return;
    case "use_as_clause": {
      const path = node.childForFieldName("path");
      const alias = node.childForFieldName("alias")?.text;
      if (path) out.push({ path: [...prefix, ...path.text.replace(/\s+/g, "").split("::").filter(Boolean)], glob: false, ...(alias ? { alias } : {}) });
      return;
    }
    case "scoped_use_list": {
      const path = node.childForFieldName("path");
      const next = path ? [...prefix, ...path.text.replace(/\s+/g, "").split("::").filter(Boolean)] : prefix;
      const list = node.childForFieldName("list");
      if (list) flattenUse(list, next, out);
      return;
    }
    case "use_list":
      for (const c of node.namedChildren) if (c) flattenUse(c, prefix, out);
      return;
    case "use_wildcard": {
      const path = node.namedChildren[0];
      out.push({ path: [...prefix, ...(path ? path.text.replace(/\s+/g, "").split("::").filter(Boolean) : [])], glob: true });
      return;
    }
  }
}

/** `#[cfg(test)]`, `#[test]`, `#[tokio::test]` and similar on the attributes above an item. */
function isTestItem(item: Node): boolean {
  for (let prev = item.previousNamedSibling; prev && (prev.type === "attribute_item" || prev.type === "line_comment" || prev.type === "block_comment"); prev = prev.previousNamedSibling) {
    const attr = prev.type === "attribute_item" ? prev.namedChildren.find((c) => c?.type === "attribute") : undefined;
    const text = attr?.text.replace(/\s+/g, "") ?? "";
    if (text === "test" || text.endsWith("::test") || /^cfg\((.*[(,])?test[),]/.test(text)) return true;
  }
  return false;
}

function isPublic(node: Node): boolean {
  return node.namedChildren.some((c) => c?.type === "visibility_modifier");
}

/** Route attribute macros directly above an item: `#[get("/users")]`, `#[actix_web::post("/x")]`. */
function routeAttributes(item: Node): { method: string; route: string; line: number }[] {
  const out: { method: string; route: string; line: number }[] = [];
  for (let prev = item.previousNamedSibling; prev && (prev.type === "attribute_item" || prev.type === "line_comment" || prev.type === "block_comment"); prev = prev.previousNamedSibling) {
    if (prev.type !== "attribute_item") continue;
    const attr = prev.namedChildren.find((c) => c?.type === "attribute");
    const name = attr?.namedChildren[0];
    const method = name ? lastSegment(name.text) : "";
    if (!HTTP_ATTRS.has(method)) continue;
    const literal = attr?.childForFieldName("arguments")?.namedChildren.find((c) => c?.type === "string_literal");
    const route = literal ? stringValue(literal) : undefined;
    if (route?.startsWith("/")) out.push({ method: method.toUpperCase(), route, line: prev.startPosition.row + 1 });
  }
  return out.reverse();
}

export function extractRust(path: string, root: Node): ParsedFile {
  const symbols: CodeSymbol[] = [];
  const imports: ImportRecord[] = [];
  const calls: CallSite[] = [];
  const routes: RouteDecl[] = [];
  const seen = new Set<string>();
  /** `Type.field` → declared type, for structs in this file. */
  const fieldTypes = new Map<string, string>();
  let mainAt: number | undefined;
  const isBinaryRoot = /(^|\/)(main\.rs|bin\/[^/]+\.rs|bin\/[^/]+\/main\.rs)$/.test(path);

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

  // Struct field types first, so `self.field.m()` can be typed wherever the impl is.
  const collectFields = (container: Node, prefix: string) => {
    for (const node of container.namedChildren) {
      if (node?.type === "struct_item") {
        const name = node.childForFieldName("name")?.text;
        const body = node.childForFieldName("body");
        if (!name || body?.type !== "field_declaration_list") continue;
        for (const f of body.namedChildren) {
          if (f?.type !== "field_declaration") continue;
          const field = f.childForFieldName("name")?.text;
          const type = rustTypeName(f.childForFieldName("type"));
          if (field && type) fieldTypes.set(`${prefix}${name}.${field}`, type);
        }
      } else if (node?.type === "mod_item") {
        const body = node.childForFieldName("body");
        const name = node.childForFieldName("name")?.text;
        if (body && name) collectFields(body, `${prefix}${name}.`);
      }
    }
  };
  collectFields(root, "");

  /** Local name → declared type for one function (null when bound twice with different types). */
  const scopeOf = (fn: Node): Map<string, string | null> => {
    const scope = new Map<string, string | null>();
    const bind = (name: string | undefined, type: string | undefined) => {
      if (!name || !type) return;
      if (scope.has(name) && scope.get(name) !== type) scope.set(name, null);
      else scope.set(name, type);
    };
    for (const p of fn.childForFieldName("parameters")?.namedChildren ?? []) {
      if (p?.type === "parameter") bind(patternName(p.childForFieldName("pattern")), rustTypeName(p.childForFieldName("type")));
    }
    const visit = (node: Node, depth: number) => {
      if (depth > MAX_DEPTH) return;
      if (node.type === "function_item" || node.type === "closure_expression") return;
      if (node.type === "let_declaration") {
        const name = patternName(node.childForFieldName("pattern"));
        const value = node.childForFieldName("value");
        const declared = rustTypeName(node.childForFieldName("type"));
        const literal = value?.type === "struct_expression" ? value.childForFieldName("name")?.text : undefined;
        if (name) {
          if (declared ?? literal) bind(name, declared ?? literal);
          // An untyped rebinding shadows the earlier type: we no longer know it.
          else if (scope.has(name)) scope.set(name, null);
        }
      }
      for (const c of node.namedChildren) if (c) visit(c, depth + 1);
    };
    const body = fn.childForFieldName("body");
    if (body) for (const c of body.namedChildren) if (c) visit(c, 1);
    return scope;
  };

  interface FnContext {
    id: string;
    /** Inside `#[cfg(test)]` or a `#[test]` function: routes here aren't the product's. */
    inTest: boolean;
    scope: Map<string, string | null>;
    /** The `impl` type, with any `mod` prefix, for `self` and `Self`. */
    selfType?: string;
  }

  const pathText = (node: Node) => node.text.replace(/\s+/g, "").replace(/::<[^>]*>/g, "");

  const calleeOf = (fn: Node, ctx: FnContext | undefined): { callee: string; receiverType?: string } | undefined => {
    if (fn.type === "generic_function") {
      const inner = fn.childForFieldName("function");
      return inner ? calleeOf(inner, ctx) : undefined;
    }
    if (fn.type === "identifier") return { callee: fn.text };
    if (fn.type === "scoped_identifier") {
      const text = pathText(fn);
      if (text.startsWith("<")) return undefined;
      if (text.startsWith("Self::") && ctx?.selfType) return { callee: `${ctx.selfType.replace(/\./g, "::")}::${text.slice(6)}` };
      return { callee: text };
    }
    if (fn.type === "field_expression") {
      const value = fn.childForFieldName("value");
      const field = fn.childForFieldName("field")?.text;
      if (!value || !field) return undefined;
      if (value.type === "self") return { callee: `self.${field}` };
      if (value.type === "identifier") {
        const type = ctx?.scope.get(value.text);
        return { callee: `${value.text}.${field}`, ...(type ? { receiverType: type } : {}) };
      }
      if (value.type === "field_expression" && value.childForFieldName("value")?.type === "self") {
        const member = value.childForFieldName("field")?.text;
        const type = member && ctx?.selfType ? fieldTypes.get(`${ctx.selfType}.${member}`) : undefined;
        return { callee: `self.${member}.${field}`, ...(type ? { receiverType: type } : {}) };
      }
    }
    return undefined;
  };

  /** axum: `.route("/users", get(list).post(create))` → one route per method. */
  const axumMethods = (node: Node, out: { method: string; handler: Node }[]) => {
    if (node.type !== "call_expression") return;
    const fn = node.childForFieldName("function");
    const args = node.childForFieldName("arguments")?.namedChildren.filter((a): a is Node => !!a) ?? [];
    if (fn?.type === "identifier" && HTTP_ATTRS.has(fn.text) && args.length === 1) out.push({ method: fn.text.toUpperCase(), handler: args[0] });
    else if (fn?.type === "scoped_identifier" && HTTP_ATTRS.has(lastSegment(fn.text)) && args.length === 1) out.push({ method: lastSegment(fn.text).toUpperCase(), handler: args[0] });
    else if (fn?.type === "field_expression") {
      const field = fn.childForFieldName("field")?.text;
      const value = fn.childForFieldName("value");
      if (value) axumMethods(value, out);
      if (field && HTTP_ATTRS.has(field) && args.length === 1) out.push({ method: field.toUpperCase(), handler: args[0] });
    }
  };

  const walk = (node: Node, ctx: FnContext | undefined, depth: number) => {
    if (depth > MAX_DEPTH) return;
    if (node.type === "function_item") return; // nested fns are visited as their own items
    if (node.type === "call_expression") {
      const fn = node.childForFieldName("function");
      const callee = fn ? calleeOf(fn, ctx) : undefined;
      if (callee) calls.push({ ...callee, line: node.startPosition.row + 1, ...(ctx ? { enclosing: ctx.id } : {}) });
      if (fn?.type === "field_expression" && fn.childForFieldName("field")?.text === "route") {
        const args = node.childForFieldName("arguments")?.namedChildren.filter((a): a is Node => !!a) ?? [];
        const route = args.length === 2 ? stringValue(args[0]) : undefined;
        if (route?.startsWith("/") && !ctx?.inTest) {
          const methods: { method: string; handler: Node }[] = [];
          axumMethods(args[1], methods);
          for (const m of methods) {
            const ref = m.handler.type === "identifier" || m.handler.type === "scoped_identifier" ? pathText(m.handler) : undefined;
            // In a builder chain the call starts at `Router::new()`; the path literal is on the route's own line.
            routes.push({ method: m.method, route, line: args[0].startPosition.row + 1, framework: "axum", ...(ref ? { handlerRef: ref } : {}) });
          }
        }
      }
    }
    for (const c of node.namedChildren) if (c) walk(c, ctx, depth + 1);
  };

  const visitFunction = (node: Node, name: string, qualifiedName: string, kind: SymbolKind, exported: boolean, inTest: boolean, selfType?: string) => {
    const sym = addSymbol(name, qualifiedName, kind, node, exported);
    const test = inTest || isTestItem(node);
    if (!test) for (const r of routeAttributes(node)) routes.push({ ...r, framework: "rust-attribute", handler: sym.id });
    const body = node.childForFieldName("body");
    if (body) walk(body, { id: sym.id, inTest: test, scope: scopeOf(node), ...(selfType ? { selfType } : {}) }, 1);
    return sym;
  };

  const visitItems = (container: Node, prefix: string, topLevel: boolean, inTest: boolean) => {
    for (const node of container.namedChildren) {
      if (!node) continue;
      const name = node.childForFieldName("name")?.text;
      switch (node.type) {
        case "use_declaration": {
          const arg = node.childForFieldName("argument");
          if (!arg || !topLevel) break;
          const leaves: UseLeaf[] = [];
          flattenUse(arg, [], leaves);
          const reexport = isPublic(node);
          for (const leaf of leaves) {
            let segs = leaf.path;
            if (!leaf.glob && segs.length > 1 && segs[segs.length - 1] === "self") segs = segs.slice(0, -1);
            if (segs.length === 0) continue;
            const local = leaf.glob ? "*" : (leaf.alias ?? segs[segs.length - 1]);
            if (local === "_") continue;
            imports.push({
              specifier: segs.join("::") + (leaf.glob ? "::*" : ""),
              line: node.startPosition.row + 1,
              kind: reexport ? "reexport" : "static",
              typeOnly: false,
              bindings: [{ local, imported: leaf.glob ? "*" : segs[segs.length - 1] }],
              rust: { path: segs, glob: leaf.glob },
            });
          }
          break;
        }
        case "mod_item": {
          if (!name) break;
          const body = node.childForFieldName("body");
          if (body) visitItems(body, `${prefix}${name}.`, false, inTest || isTestItem(node));
          else if (topLevel) {
            imports.push({
              specifier: `mod ${name}`,
              line: node.startPosition.row + 1,
              kind: isPublic(node) ? "reexport" : "static",
              typeOnly: false,
              bindings: [{ local: name, imported: "*" }],
              rust: { path: ["self", name], glob: false, isMod: true },
            });
          }
          break;
        }
        case "function_item": {
          if (!name) break;
          const sym = visitFunction(node, name, `${prefix}${name}`, "function", isPublic(node), inTest);
          if (name === "main" && topLevel && isBinaryRoot) mainAt = sym.range.startLine;
          break;
        }
        case "impl_item": {
          const typeNode = node.childForFieldName("type");
          const typeName = typeNode?.type === "generic_type" ? typeNode.childForFieldName("type")?.text : typeNode?.text;
          const body = node.childForFieldName("body");
          if (!typeName || !body) break;
          const selfType = `${prefix}${lastSegment(typeName)}`;
          // Trait impls: the methods are reachable wherever the type is.
          const viaTrait = !!node.childForFieldName("trait");
          for (const m of body.namedChildren) {
            if (m?.type !== "function_item") continue;
            const mName = m.childForFieldName("name")?.text;
            if (mName) visitFunction(m, mName, `${selfType}.${mName}`, "method", viaTrait || isPublic(m), inTest, selfType);
          }
          break;
        }
        case "trait_item": {
          if (!name) break;
          addSymbol(name, `${prefix}${name}`, "interface", node, isPublic(node));
          for (const m of node.childForFieldName("body")?.namedChildren ?? []) {
            if (m?.type !== "function_item" && m?.type !== "function_signature_item") continue;
            const mName = m.childForFieldName("name")?.text;
            if (!mName) continue;
            if (m.type === "function_item") visitFunction(m, mName, `${prefix}${name}.${mName}`, "method", true, inTest, `${prefix}${name}`);
            else addSymbol(mName, `${prefix}${name}.${mName}`, "method", m, true);
          }
          break;
        }
        case "struct_item":
        case "union_item":
          if (name) addSymbol(name, `${prefix}${name}`, "class", node, isPublic(node));
          break;
        case "enum_item":
          if (name) addSymbol(name, `${prefix}${name}`, "enum", node, isPublic(node));
          break;
        case "type_item":
          if (name) addSymbol(name, `${prefix}${name}`, "type", node, isPublic(node));
          break;
        case "const_item":
        case "static_item":
          if (name) addSymbol(name, `${prefix}${name}`, "variable", node, isPublic(node));
          walk(node, undefined, 1);
          break;
        default:
          break;
      }
    }
  };
  visitItems(root, "", true, false);
  // A builder chain is visited outermost-first; report routes in source order.
  routes.sort((a, b) => a.line - b.line);

  return { path, language: "rust", parser: "tree-sitter", lineCount: 0, symbols, imports, calls, routes, exports: {}, ...(mainAt ? { mainAt } : {}) };
}
