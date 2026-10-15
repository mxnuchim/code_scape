# Deploying CodeScape

The website and the hosted MCP endpoint are one Next.js app. Deploying it gives you:

- the 3D map for any public GitHub repository, at `https://<your-site>/<owner>/<repo>`;
- the hosted MCP endpoint, at `https://<your-site>/api/mcp/<owner>/<repo>`, which every city offers as a one-line `claude mcp add` command.

Local mode (`/local`, `codescape view`) and the local MCP server keep working from a clone. On a public deployment, the local API routes answer only requests addressed to `localhost`, and no repository root is configured, so they serve nothing.

## What you need

- The repository on GitHub (Vercel deploys from it).
- A Vercel account. The steps below use Vercel's dashboard. Any host that runs Node 22 works too; see [Other hosts](#other-hosts).
- A GitHub token, so the server isn't limited to GitHub's 60 anonymous API requests an hour, which are shared by everyone using your site.

## 1. Create the GitHub token

The token only reads public repositories. It never touches your account's private data.

1. On GitHub, open **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
2. Name it, for example `codescape-public-read`, and choose an expiry. You'll rotate it when it expires.
3. Under **Repository access**, choose **Public repositories**. Add no permissions.
4. Generate it and copy the value. You'll paste it into Vercel in the next step. Don't commit it or share it anywhere else.

With the token, the server gets 5,000 API requests an hour. Each repository analysis uses about 2 of them; file contents come from `raw.githubusercontent.com`, which isn't counted against the API limit.

## 2. Create the Vercel project

1. In Vercel, choose **Add New → Project** and import the CodeScape repository.
2. Vercel detects Next.js and pnpm (from `pnpm-lock.yaml`). Leave the build and install commands at their defaults. `pnpm install` copies the tree-sitter WASM files into `public/wasm` (`postinstall`), and `pnpm build` does it again (`prebuild`).
3. Under **Environment Variables**, add:

   | Name | Value | Required |
   |---|---|---|
   | `GITHUB_TOKEN` | the token from step 1 | Strongly recommended |
   | `CODESCAPE_SITE_URL` | your public address, e.g. `https://codescape.example.com` | Optional. MCP map links use the request's own address when this is unset, which is right unless a proxy rewrites it. |

4. Deploy.
5. In **Settings → Build and Deployment**, set **Node.js Version** to **22.x** to match `.nvmrc`, and redeploy if it was different.

Pushing to the default branch redeploys production; pull requests get preview deployments.

## 3. Protect the MCP endpoint

Anyone who can reach your site can ask it to analyse a public repository. The first call for a repository reads up to 600 files and parses them for up to about 40 seconds, so put a rate limit in front of the endpoint:

- In Vercel, open **Firewall** and add a rule: if the request path starts with `/api/mcp/`, rate-limit it per IP (for example 60 requests a minute). A conversation makes one request per tool call, so normal use stays well under that.
- The route allows up to 60 seconds per request (`maxDuration` in `src/app/api/mcp/[owner]/[repo]/route.ts`). Analyses that run longer stop reading files and report what they left out.

The analysis cache lives in memory on each server instance for 15 minutes (up to 24 repositories). A new instance, or a different one, analyses again; nothing is stored anywhere else.

## 4. Check it

Open your site and load a repository, for example `https://<your-site>/pallets/flask`. Then check the endpoint with an MCP handshake:

```bash
curl -s "https://<your-site>/api/mcp/pallets/flask" -H "content-type: application/json" -H "accept: application/json, text/event-stream" -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}'
```

The response names the server `codescape` and includes instructions that mention `pallets/flask`. Then connect Claude Code and ask it something:

```bash
claude mcp add --transport http codescape-flask "https://<your-site>/api/mcp/pallets/flask"
```

In Claude Code, `/mcp` should list `codescape-flask` as connected. Ask *"Give me an overview of this codebase and show me in CodeScape."* The answer should cite `path:line` and end with a link to your site.

If a tool says GitHub's rate limit was reached, `GITHUB_TOKEN` isn't set, or it has expired. Check the variable, then redeploy.

## 5. Custom domain

In Vercel, open **Settings → Domains**, add your domain and follow the DNS instructions. Then update `CODESCAPE_SITE_URL` if you set it, and redeploy. The commands the site shows always use the address the visitor is on.

## Other hosts

Any platform that runs a Node 22 server works:

```bash
pnpm install --frozen-lockfile
pnpm build
GITHUB_TOKEN=… pnpm start   # serves on port 3000; set PORT to change it
```

Run it behind HTTPS, and put a rate limit on `/api/mcp/` at your proxy. The server needs outbound access to `api.github.com` and `raw.githubusercontent.com`.

## Updating and rolling back

- **Update:** merge to the default branch; Vercel builds and promotes it.
- **Roll back:** in Vercel's **Deployments** list, open an earlier production deployment and choose **Promote** (or **Instant Rollback**).
- **Rotate the token:** create a new one, replace `GITHUB_TOKEN`, redeploy, then delete the old token on GitHub.
