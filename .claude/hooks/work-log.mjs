#!/usr/bin/env node
// Work-log hook: keeps EXECUTION.md, LEARNINGS.md and INTERFACE.md current.
//
//   session-start  remember HEAD so later diffs cover this session's commits too
//   stop           if this session changed a lot and the logs weren't touched,
//                  block the stop and tell the agent what to write
//
// Wired up in .claude/settings.json. Never throws: a broken hook must not
// wedge an agent, so every failure path exits 0.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const LOGS = ["EXECUTION.md", "LEARNINGS.md", "INTERFACE.md"];
const LARGE_TASK_FILES = 5;
const UI_PATHS = [/^src\/components\//, /^src\/app\/.*\.(tsx|css)$/, /^src\/theme\//];

function readStdin() {
  try {
    return JSON.parse(readFileSync(0, "utf8") || "{}");
  } catch {
    return {};
  }
}

function git(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

function statePath(root, sessionId) {
  const dir = join(root, ".claude", "state");
  mkdirSync(dir, { recursive: true });
  return join(dir, `session-${String(sessionId || "unknown").replace(/[^\w-]/g, "")}.json`);
}

function changedFiles(root, base) {
  const tracked = git(root, ["diff", "--name-only", base]).split("\n");
  const untracked = git(root, ["ls-files", "--others", "--exclude-standard"]).split("\n");
  return [...new Set([...tracked, ...untracked])].filter((p) => p && !p.startsWith(".claude/state/"));
}

function main() {
  const mode = process.argv[2];
  const input = readStdin();
  const root = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
  if (!existsSync(join(root, ".git"))) return;
  const file = statePath(root, input.session_id);

  if (mode === "session-start") {
    if (!existsSync(file)) writeFileSync(file, JSON.stringify({ head: git(root, ["rev-parse", "HEAD"]) }));
    return;
  }

  if (mode !== "stop" || input.stop_hook_active) return;
  let base = "HEAD";
  try {
    base = JSON.parse(readFileSync(file, "utf8")).head || "HEAD";
  } catch {
    // No session record: fall back to uncommitted changes only.
  }
  const changed = changedFiles(root, base);
  const work = changed.filter((p) => !LOGS.includes(p));
  if (work.length < LARGE_TASK_FILES) return;

  const missing = [];
  if (!changed.includes("EXECUTION.md")) missing.push("EXECUTION.md (timestamped steps you executed, in order)");
  if (work.some((p) => UI_PATHS.some((re) => re.test(p))) && !changed.includes("INTERFACE.md")) {
    missing.push("INTERFACE.md (UI/design decisions you made, so future UI stays consistent)");
  }
  if (!changed.includes("LEARNINGS.md")) {
    missing.push("LEARNINGS.md (problems hit and how they were solved; write 'nothing new' only if truly nothing)");
  }
  if (missing.length === 0) return;

  process.stdout.write(
    JSON.stringify({
      decision: "block",
      reason:
        `This session changed ${work.length} files, which counts as a large task. Before finishing, append ` +
        `timestamped entries (\`date "+%Y-%m-%d %H:%M %Z"\`) to: ${missing.join("; ")}. ` +
        "Follow the format at the top of each file. Then you may stop.",
    }),
  );
}

try {
  main();
} catch {
  // Swallow everything: see the header comment.
}
