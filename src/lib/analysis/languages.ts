/**
 * Language identification by file extension or well-known filename.
 * This is a lightweight stand-in for GitHub Linguist: it only looks at names.
 */

export interface LanguageInfo {
  id: string;
  name: string;
}

const L = (id: string, name: string): LanguageInfo => ({ id, name });

export const LANGUAGES: Record<string, LanguageInfo> = {
  typescript: L("typescript", "TypeScript"),
  javascript: L("javascript", "JavaScript"),
  python: L("python", "Python"),
  go: L("go", "Go"),
  rust: L("rust", "Rust"),
  java: L("java", "Java"),
  kotlin: L("kotlin", "Kotlin"),
  swift: L("swift", "Swift"),
  objc: L("objc", "Objective-C"),
  c: L("c", "C"),
  cpp: L("cpp", "C++"),
  csharp: L("csharp", "C#"),
  fsharp: L("fsharp", "F#"),
  ruby: L("ruby", "Ruby"),
  php: L("php", "PHP"),
  scala: L("scala", "Scala"),
  dart: L("dart", "Dart"),
  elixir: L("elixir", "Elixir"),
  erlang: L("erlang", "Erlang"),
  haskell: L("haskell", "Haskell"),
  ocaml: L("ocaml", "OCaml"),
  clojure: L("clojure", "Clojure"),
  lua: L("lua", "Lua"),
  r: L("r", "R"),
  julia: L("julia", "Julia"),
  zig: L("zig", "Zig"),
  nim: L("nim", "Nim"),
  solidity: L("solidity", "Solidity"),
  shell: L("shell", "Shell"),
  powershell: L("powershell", "PowerShell"),
  html: L("html", "HTML"),
  css: L("css", "CSS"),
  scss: L("scss", "Sass/SCSS"),
  less: L("less", "Less"),
  vue: L("vue", "Vue"),
  svelte: L("svelte", "Svelte"),
  astro: L("astro", "Astro"),
  markdown: L("markdown", "Markdown"),
  mdx: L("mdx", "MDX"),
  rst: L("rst", "reStructuredText"),
  text: L("text", "Text"),
  json: L("json", "JSON"),
  yaml: L("yaml", "YAML"),
  toml: L("toml", "TOML"),
  xml: L("xml", "XML"),
  csv: L("csv", "CSV"),
  sql: L("sql", "SQL"),
  graphql: L("graphql", "GraphQL"),
  protobuf: L("protobuf", "Protocol Buffers"),
  docker: L("docker", "Dockerfile"),
  make: L("make", "Makefile"),
  cmake: L("cmake", "CMake"),
  nix: L("nix", "Nix"),
  hcl: L("hcl", "HCL"),
  ini: L("ini", "INI"),
  image: L("image", "Image"),
  font: L("font", "Font"),
  media: L("media", "Media"),
  model3d: L("model3d", "3D model"),
  binary: L("binary", "Binary"),
  other: L("other", "Other"),
};

const EXT: Record<string, string> = {
  ts: "typescript", tsx: "typescript", mts: "typescript", cts: "typescript",
  js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
  py: "python", pyi: "python", pyx: "python", ipynb: "python",
  go: "go",
  rs: "rust",
  java: "java",
  kt: "kotlin", kts: "kotlin",
  swift: "swift",
  m: "objc", mm: "objc",
  c: "c", h: "c",
  cc: "cpp", cpp: "cpp", cxx: "cpp", hpp: "cpp", hh: "cpp", hxx: "cpp",
  cs: "csharp", csx: "csharp",
  fs: "fsharp", fsx: "fsharp",
  rb: "ruby", erb: "ruby", rake: "ruby", gemspec: "ruby",
  php: "php",
  scala: "scala", sc: "scala",
  dart: "dart",
  ex: "elixir", exs: "elixir",
  erl: "erlang", hrl: "erlang",
  hs: "haskell", lhs: "haskell",
  ml: "ocaml", mli: "ocaml",
  clj: "clojure", cljs: "clojure", cljc: "clojure", edn: "clojure",
  lua: "lua",
  r: "r",
  jl: "julia",
  zig: "zig",
  nim: "nim",
  sol: "solidity",
  sh: "shell", bash: "shell", zsh: "shell", fish: "shell",
  ps1: "powershell", psm1: "powershell",
  html: "html", htm: "html", hbs: "html", handlebars: "html", njk: "html", ejs: "html", pug: "html",
  css: "css", pcss: "css", postcss: "css",
  scss: "scss", sass: "scss",
  less: "less", styl: "less",
  vue: "vue",
  svelte: "svelte",
  astro: "astro",
  md: "markdown", markdown: "markdown",
  mdx: "mdx",
  rst: "rst", adoc: "rst",
  txt: "text",
  json: "json", jsonc: "json", json5: "json", webmanifest: "json",
  yml: "yaml", yaml: "yaml",
  toml: "toml",
  xml: "xml", plist: "xml", xsd: "xml",
  csv: "csv", tsv: "csv",
  sql: "sql",
  graphql: "graphql", gql: "graphql",
  proto: "protobuf",
  dockerfile: "docker",
  mk: "make",
  cmake: "cmake",
  nix: "nix",
  tf: "hcl", hcl: "hcl", tfvars: "hcl",
  ini: "ini", cfg: "ini", conf: "ini", properties: "ini", env: "ini",
  png: "image", jpg: "image", jpeg: "image", gif: "image", svg: "image", webp: "image",
  ico: "image", avif: "image", bmp: "image", tif: "image", tiff: "image", icns: "image",
  woff: "font", woff2: "font", ttf: "font", otf: "font", eot: "font",
  mp4: "media", webm: "media", mov: "media", mp3: "media", wav: "media", ogg: "media",
  flac: "media", m4a: "media", pdf: "media",
  glb: "model3d", gltf: "model3d", obj: "model3d", fbx: "model3d", hdr: "model3d", exr: "model3d",
  zip: "binary", gz: "binary", tgz: "binary", tar: "binary", wasm: "binary", jar: "binary",
};

const FILENAMES: Record<string, string> = {
  dockerfile: "docker",
  containerfile: "docker",
  makefile: "make",
  gnumakefile: "make",
  "cmakelists.txt": "cmake",
  rakefile: "ruby",
  gemfile: "ruby",
  podfile: "ruby",
  brewfile: "ruby",
  jenkinsfile: "other",
  justfile: "make",
  vagrantfile: "ruby",
  procfile: "ini",
  license: "text",
  licence: "text",
  copying: "text",
  authors: "text",
  notice: "text",
  codeowners: "text",
};

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return "";
  return name.slice(dot + 1).toLowerCase();
}

export function detectLanguage(name: string): LanguageInfo {
  const lower = name.toLowerCase();
  const byName = FILENAMES[lower];
  if (byName) return LANGUAGES[byName];
  if (lower.startsWith("dockerfile") || lower.endsWith(".dockerfile")) return LANGUAGES.docker;
  if (lower.startsWith(".env")) return LANGUAGES.ini;
  const ext = extensionOf(lower);
  const id = ext ? EXT[ext] : undefined;
  if (id) return LANGUAGES[id];
  // Dotfiles like .eslintrc, .prettierrc, .npmrc are almost always config.
  if (lower.startsWith(".") && lower.endsWith("rc")) return LANGUAGES.ini;
  return LANGUAGES.other;
}
