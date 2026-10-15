/**
 * The repository library: famous public repositories, grouped for browsing.
 *
 * Every entry is a real, public, unarchived GitHub repository. The counts
 * come from running CodeScape's own model (`buildRepoModel`, `planTrace`) on
 * GitHub's recursive tree listing on LIBRARY_MEASURED_ON, so they match what
 * the city shows: dependencies, vendored folders and build output are left
 * out. Hooks describe what the repository contains, never a closed product it
 * doesn't (Instagram, Snapchat and the Facebook app are not here).
 */

import { TRACE_FILE_CAP } from "@/lib/analysis/imports/trace";
import { LANGUAGES, PARSED_LANGUAGES } from "@/lib/analysis/languages";
import { formatCompact } from "@/lib/format";

export const LIBRARY_MEASURED_ON = "2026-10-15";

/** Language ids that CodeScape parses for imports and calls. */
const PARSED_LANGUAGE_IDS = new Set(
  Object.values(LANGUAGES)
    .filter((l) => (PARSED_LANGUAGES as readonly string[]).includes(l.name))
    .map((l) => l.id),
);

export interface LibraryRepo {
  owner: string;
  repo: string;
  /** The product or project name people know it by. */
  title: string;
  /** One literal line about what is inside. */
  hook: string;
  /** The most common language among its source files, tests excluded (a `LANGUAGES` id). */
  language: string;
  /** Files CodeScape maps. A lower bound when `truncated`. */
  files: number;
  /** Files CodeScape could parse (`planTrace` eligible), before the browser's cap. */
  sourceFiles: number;
  /** GitHub truncated the tree listing (over 100,000 entries or 7 MB). */
  truncated?: boolean;
  /** Extra search words: company, product, topic. */
  keywords?: string;
}

export interface LibraryCategory {
  id: string;
  title: string;
  blurb: string;
  repos: LibraryRepo[];
}

export const LIBRARY: LibraryCategory[] = [
  {
    id: "big-tech",
    title: "Inside big tech",
    blurb: "Code that X, Meta, Microsoft, Google, Netflix and others publish in the open.",
    repos: [
      { owner: "twitter", repo: "the-algorithm", title: "X's recommendation algorithm", hook: "The services and jobs behind X's For You feed, as X published them in 2023.", language: "scala", files: 7667, sourceFiles: 1253, keywords: "twitter x feed ranking timeline" },
      { owner: "react", repo: "react", title: "React", hook: "The UI library that started at Meta: the reconciler, hooks and React DOM.", language: "javascript", files: 7134, sourceFiles: 4556, keywords: "meta facebook frontend ui" },
      { owner: "microsoft", repo: "vscode", title: "Visual Studio Code", hook: "The editor itself: the workbench, the extension host and the Monaco core.", language: "typescript", files: 20021, sourceFiles: 14707, keywords: "editor ide electron" },
      { owner: "microsoft", repo: "TypeScript", title: "TypeScript", hook: "Microsoft's compiler, with its new Go implementation in the tsc folder.", language: "go", files: 51176, sourceFiles: 17655, truncated: true, keywords: "compiler typechecker tsc" },
      { owner: "pytorch", repo: "pytorch", title: "PyTorch", hook: "The deep-learning framework from Meta: a Python front end over a C++ core.", language: "python", files: 22702, sourceFiles: 5100, keywords: "meta ml machine learning tensors gpu" },
      { owner: "meta-llama", repo: "llama-models", title: "Llama models", hook: "Meta's reference code and utilities for the Llama model family.", language: "python", files: 110, sourceFiles: 61, keywords: "meta llm ai" },
      { owner: "google", repo: "guava", title: "Guava", hook: "Google's core Java libraries: collections, caching, hashing and more.", language: "java", files: 3363, sourceFiles: 3275, keywords: "collections jvm" },
      { owner: "Netflix", repo: "zuul", title: "Zuul", hook: "Netflix's edge gateway for routing, filtering and resilience.", language: "java", files: 421, sourceFiles: 374, keywords: "gateway proxy streaming" },
      { owner: "backstage", repo: "backstage", title: "Backstage", hook: "The developer portal Spotify built and then open-sourced.", language: "typescript", files: 12256, sourceFiles: 7739, keywords: "spotify portal platform" },
      { owner: "desktop", repo: "desktop", title: "GitHub Desktop", hook: "GitHub's own Git client, an Electron and React app.", language: "typescript", files: 2546, sourceFiles: 1221, keywords: "github git electron" },
      { owner: "vercel", repo: "next.js", title: "Next.js", hook: "Vercel's React framework: the router, the compiler and the dev server.", language: "typescript", files: 32871, sourceFiles: 26190, keywords: "react framework turbopack" },
    ],
  },
  {
    id: "infrastructure",
    title: "Infrastructure that runs the internet",
    blurb: "Containers, kernels, proxies and databases that most software quietly depends on.",
    repos: [
      { owner: "moby", repo: "moby", title: "Docker Engine (Moby)", hook: "The container engine at the heart of Docker.", language: "go", files: 3373, sourceFiles: 2279, keywords: "docker containers dockerd" },
      { owner: "kubernetes", repo: "kubernetes", title: "Kubernetes", hook: "The container orchestrator, from the API server to the kubelet.", language: "go", files: 25993, sourceFiles: 13573, keywords: "k8s containers orchestration google cloud" },
      { owner: "torvalds", repo: "linux", title: "Linux", hook: "The kernel itself, from Linus Torvalds's tree.", language: "c", files: 67368, sourceFiles: 126, truncated: true, keywords: "kernel os operating system" },
      { owner: "nginx", repo: "nginx", title: "NGINX", hook: "The web server and reverse proxy in front of a large share of the web.", language: "c", files: 543, sourceFiles: 0, keywords: "web server proxy http" },
      { owner: "redis", repo: "redis", title: "Redis", hook: "The in-memory data store, in compact C.", language: "c", files: 1936, sourceFiles: 51, keywords: "cache database key value" },
      { owner: "cloudflare", repo: "pingora", title: "Pingora", hook: "Cloudflare's Rust framework for building fast network proxies.", language: "rust", files: 404, sourceFiles: 234, keywords: "proxy http cdn" },
      { owner: "hashicorp", repo: "terraform", title: "Terraform", hook: "Infrastructure as code: plan, apply and the provider protocol.", language: "go", files: 5460, sourceFiles: 2038, keywords: "iac cloud devops" },
      { owner: "prometheus", repo: "prometheus", title: "Prometheus", hook: "The monitoring system and its time-series database.", language: "go", files: 1694, sourceFiles: 1003, keywords: "metrics monitoring observability tsdb" },
      { owner: "apache", repo: "kafka", title: "Apache Kafka", hook: "The distributed event log behind countless data pipelines.", language: "java", files: 7605, sourceFiles: 6425, keywords: "streaming events queue linkedin" },
      { owner: "postgres", repo: "postgres", title: "PostgreSQL", hook: "The database, mirrored from its official Git repository.", language: "c", files: 7642, sourceFiles: 6, keywords: "database sql postgresql" },
      { owner: "git", repo: "git", title: "Git", hook: "Version control itself, in C and shell.", language: "shell", files: 4854, sourceFiles: 21, keywords: "vcs version control" },
    ],
  },
  {
    id: "ai",
    title: "AI in 2026",
    blurb: "Coding agents, open models and the engines that run them.",
    repos: [
      { owner: "openai", repo: "codex", title: "Codex CLI", hook: "OpenAI's coding agent for the terminal, written mostly in Rust.", language: "rust", files: 9155, sourceFiles: 6266, keywords: "agent coding llm" },
      { owner: "google-gemini", repo: "gemini-cli", title: "Gemini CLI", hook: "Google's open-source agent that brings Gemini to the terminal.", language: "typescript", files: 3019, sourceFiles: 2306, keywords: "google agent coding llm" },
      { owner: "karpathy", repo: "nanochat", title: "nanochat", hook: "Andrej Karpathy's end-to-end ChatGPT-style training and chat stack, small enough to read.", language: "python", files: 52, sourceFiles: 36, keywords: "llm training gpt" },
      { owner: "karpathy", repo: "nanoGPT", title: "nanoGPT", hook: "The smallest readable GPT training code, and a classic first read.", language: "python", files: 26, sourceFiles: 15, keywords: "llm transformer training" },
      { owner: "ollama", repo: "ollama", title: "Ollama", hook: "Run open models locally: the Go server behind the ollama command.", language: "go", files: 1448, sourceFiles: 1014, keywords: "local llm inference" },
      { owner: "huggingface", repo: "transformers", title: "Transformers", hook: "Hugging Face's library of model definitions, from BERT to current LLMs.", language: "python", files: 6572, sourceFiles: 4941, keywords: "ml models nlp llm" },
      { owner: "vllm-project", repo: "vllm", title: "vLLM", hook: "A high-throughput engine for serving LLMs.", language: "python", files: 7802, sourceFiles: 5513, keywords: "inference serving gpu" },
      { owner: "ggml-org", repo: "llama.cpp", title: "llama.cpp", hook: "LLM inference in C and C++, the engine under many local AI apps.", language: "cpp", files: 3766, sourceFiles: 1036, keywords: "local inference gguf" },
      { owner: "xai-org", repo: "grok-1", title: "Grok-1", hook: "xAI's example code for loading and running the Grok-1 open weights.", language: "python", files: 12, sourceFiles: 4, keywords: "xai llm jax" },
      { owner: "openai", repo: "whisper", title: "Whisper", hook: "OpenAI's speech-recognition model, in plain PyTorch.", language: "python", files: 45, sourceFiles: 20, keywords: "speech audio transcription asr" },
      { owner: "modelcontextprotocol", repo: "servers", title: "MCP servers", hook: "Reference servers for the Model Context Protocol, the way agents reach tools.", language: "typescript", files: 316, sourceFiles: 207, keywords: "mcp agents tools anthropic" },
    ],
  },
  {
    id: "apps",
    title: "Apps you use",
    blurb: "Real apps whose source is public: messengers, social, editors and tools.",
    repos: [
      { owner: "signalapp", repo: "Signal-Server", title: "Signal Server", hook: "The server that Signal's apps talk to.", language: "java", files: 1425, sourceFiles: 1289, keywords: "messenger encryption privacy chat" },
      { owner: "signalapp", repo: "Signal-Desktop", title: "Signal Desktop", hook: "The Signal messenger for Windows, macOS and Linux.", language: "typescript", files: 4486, sourceFiles: 3013, keywords: "messenger electron chat" },
      { owner: "bluesky-social", repo: "social-app", title: "Bluesky", hook: "The Bluesky app for web, iOS and Android, in React Native.", language: "typescript", files: 3597, sourceFiles: 2135, keywords: "social network atproto react native" },
      { owner: "mastodon", repo: "mastodon", title: "Mastodon", hook: "The decentralized social network: a Rails back end and a React front end.", language: "ruby", files: 10119, sourceFiles: 973, keywords: "social fediverse activitypub rails" },
      { owner: "excalidraw", repo: "excalidraw", title: "Excalidraw", hook: "The hand-drawn-style whiteboard, as a React app.", language: "typescript", files: 1312, sourceFiles: 694, keywords: "whiteboard diagrams canvas" },
      { owner: "zed-industries", repo: "zed", title: "Zed", hook: "A fast, multiplayer code editor written in Rust.", language: "rust", files: 4380, sourceFiles: 2053, keywords: "editor ide gpui" },
      { owner: "bitwarden", repo: "clients", title: "Bitwarden", hook: "The password manager's web vault, browser extension, desktop app and CLI.", language: "typescript", files: 9400, sourceFiles: 6962, keywords: "passwords security angular" },
      { owner: "immich-app", repo: "immich", title: "Immich", hook: "Self-hosted photo and video backup with a web and mobile app.", language: "typescript", files: 3500, sourceFiles: 1566, keywords: "photos backup self-hosted" },
      { owner: "home-assistant", repo: "core", title: "Home Assistant", hook: "Open-source home automation with thousands of device integrations.", language: "python", files: 29083, sourceFiles: 19556, keywords: "smart home iot automation" },
    ],
  },
  {
    id: "languages",
    title: "Languages and runtimes",
    blurb: "The compilers and runtimes your code runs on.",
    repos: [
      { owner: "rust-lang", repo: "rust", title: "Rust", hook: "The Rust compiler and standard library, written in Rust.", language: "rust", files: 59628, sourceFiles: 37237, truncated: true, keywords: "compiler rustc language" },
      { owner: "golang", repo: "go", title: "Go", hook: "The Go toolchain, runtime and standard library, written in Go.", language: "go", files: 14820, sourceFiles: 10754, keywords: "compiler golang language google" },
      { owner: "python", repo: "cpython", title: "CPython", hook: "The reference Python interpreter: a C core and the standard library.", language: "c", files: 5452, sourceFiles: 2369, keywords: "interpreter language" },
      { owner: "nodejs", repo: "node", title: "Node.js", hook: "The JavaScript runtime: core modules in lib, with V8 and libuv vendored in deps.", language: "c", files: 52413, sourceFiles: 24092, keywords: "runtime v8 server" },
      { owner: "denoland", repo: "deno", title: "Deno", hook: "The JavaScript and TypeScript runtime, with a Rust core.", language: "rust", files: 14333, sourceFiles: 5747, keywords: "runtime v8 rust" },
      { owner: "oven-sh", repo: "bun", title: "Bun", hook: "The all-in-one JavaScript runtime, now written in Rust on top of JavaScriptCore.", language: "rust", files: 23841, sourceFiles: 14756, keywords: "runtime bundler package manager rust" },
      { owner: "swiftlang", repo: "swift", title: "Swift", hook: "The Swift compiler and standard library that Apple started.", language: "swift", files: 33204, sourceFiles: 288, keywords: "apple compiler ios llvm" },
      { owner: "openjdk", repo: "jdk", title: "OpenJDK", hook: "The Java platform: the HotSpot VM, the javac compiler and the class library.", language: "java", files: 46507, sourceFiles: 31829, truncated: true, keywords: "java jvm hotspot oracle" },
    ],
  },
];

/** The headline picks on the landing card. */
export const FEATURED: { owner: string; repo: string; label: string }[] = [
  { owner: "twitter", repo: "the-algorithm", label: "X's algorithm" },
  { owner: "moby", repo: "moby", label: "Docker" },
  { owner: "kubernetes", repo: "kubernetes", label: "Kubernetes" },
  { owner: "openai", repo: "codex", label: "Codex CLI" },
  { owner: "react", repo: "react", label: "React" },
];

export const LIBRARY_SIZE = LIBRARY.reduce((n, c) => n + c.repos.length, 0);

export type AnalysisDepth = "full" | "partial" | "map";

export interface AnalysisHint {
  depth: AnalysisDepth;
  label: string;
  /** What a visitor gets in the browser, in one or two literal sentences. */
  detail: string;
}

/** Below this many parseable files, a repo in an unparsed language is treated as map-only. */
const FEW_PARSED = 50;

/** What CodeScape can show for a library repo in the browser, from its measured counts. */
export function analysisHint(r: LibraryRepo, languageName: (id: string) => string, cap = TRACE_FILE_CAP): AnalysisHint {
  const lang = languageName(r.language);
  const truncated = r.truncated ? " GitHub truncates this file listing, so the city is incomplete." : "";
  if (!PARSED_LANGUAGE_IDS.has(r.language)) {
    if (r.sourceFiles < FEW_PARSED) {
      return { depth: "map", label: "Map only", detail: `Mostly ${lang}, which CodeScape doesn't parse yet: the folders and files are real, but imports aren't traced.${truncated}` };
    }
    return {
      depth: "partial",
      label: "Partial",
      detail: `Mostly ${lang}, which CodeScape doesn't parse yet. Its ${formatCompact(r.sourceFiles)} files in parsed languages are traced, up to ${cap}.${truncated}`,
    };
  }
  if (r.sourceFiles > cap || r.truncated) {
    return { depth: "partial", label: "Partial", detail: `The browser parses ${cap} of about ${formatCompact(r.sourceFiles)} source files, starting from entry points.${truncated}` };
  }
  return { depth: "full", label: "Full analysis", detail: "Small enough for every source file to be parsed in the browser." };
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Filter the library by a free-text query. Every word must match somewhere in the entry. */
export function searchLibrary(query: string, languageName: (id: string) => string): LibraryCategory[] {
  const words = norm(query).split(" ").filter(Boolean);
  if (words.length === 0) return LIBRARY;
  return LIBRARY.map((c) => ({
    ...c,
    repos: c.repos.filter((r) => {
      const hay = norm(`${r.owner} ${r.repo} ${r.title} ${r.hook} ${languageName(r.language)} ${r.keywords ?? ""} ${c.title}`);
      return words.every((w) => hay.includes(w));
    }),
  })).filter((c) => c.repos.length > 0);
}
