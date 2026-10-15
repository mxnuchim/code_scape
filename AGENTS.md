<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Working on CodeScape

## Work logs (required for any large task)
Keep these three files at the repo root up to date *during* and *after* every large task, which means anything that touches roughly five or more files. Entries are timestamped with `date "+%Y-%m-%d %H:%M %Z"`. Append to the files; never rewrite earlier entries.
- `EXECUTION.md`: the steps you executed, in order. Include commands, changes and their outcomes.
- `LEARNINGS.md`: problems you hit and how you solved them, so nobody has to solve them twice. Read it before you start.
- `INTERFACE.md`: design decisions and UI rules. Read it before building any UI, then record new decisions in it.

A project hook (`.claude/hooks/work-log.mjs`, wired up in `.claude/settings.json`) blocks the end of a turn when a large change has no log entries.

## Environment
- Use Node 22 (`.nvmrc`). Vitest fails on Node 21.
- Before a change is done, run `pnpm lint && pnpm typecheck && pnpm test && pnpm build`.
