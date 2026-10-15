# Test fixtures

Small, hand-written repositories used by the analysis, local-workspace and MCP tests. Tests assert exact line numbers in these files, so if you edit one, update the tests that reference it.

| Fixture | Shape |
| --- | --- |
| `ts-express-api` | Express routes → service → database client, a tsconfig path alias, a Vitest test |
| `py-flask` | Flask blueprint route → service → sqlite helper, a pyproject CLI script, a `__main__` guard |
| `next-app` | Next.js App Router page and a `route.ts` API handler → lib → Prisma client |
| `go-service` | `net/http` handlers in package main → an internal package in the same module |

Hostile cases (symlinks that escape the root, secrets, binaries, unreadable folders) are generated at test time in a temporary directory, so they never live in git.
