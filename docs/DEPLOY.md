# Deploying CodeScape

The website is one Next.js app. Deploying it gives you the 3D map for any public GitHub repository at `https://<your-site>/<owner>/<repo>`.

It needs no secrets, database or storage. Repositories are fetched and analysed in each visitor's browser: about 2 GitHub API requests per city (counted against the visitor's own 60-an-hour anonymous allowance) plus raw file reads from `raw.githubusercontent.com`, which aren't counted. The server only serves the app.

Local mode (`/local`, `codescape view`) keeps working from a clone. On a public deployment its API routes answer only requests addressed to `localhost`, and no repository root is configured, so they serve nothing.

## Vercel

1. In Vercel, choose **Add New → Project** and import the CodeScape repository from GitHub.
2. Vercel detects Next.js and pnpm (from `pnpm-lock.yaml`). Leave the build and install commands at their defaults. `pnpm install` copies the tree-sitter WASM files into `public/wasm` (`postinstall`), and `pnpm build` does it again (`prebuild`).
3. No environment variables are needed. Deploy.
4. In **Settings → Build and Deployment**, set **Node.js Version** to **22.x** to match `.nvmrc`, and redeploy if it was different.

Pushing to the default branch redeploys production; pull requests get preview deployments.

## Check it

Open your site and load a repository, for example `https://<your-site>/pallets/flask`. The city should assemble, and the guide should fill in once the imports are traced.

If GitHub's rate limit is reached, the error card offers the bundled snapshot of pallets/flask, which needs no network. The limit is per visitor, so one heavy user doesn't affect anyone else.

## Custom domain

In Vercel, open **Settings → Domains**, add your domain and follow the DNS instructions.

## Other hosts

Any platform that runs a Node 22 server works:

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm start   # serves on port 3000; set PORT to change it
```

Run it behind HTTPS. The server needs no outbound network access.

## Updating and rolling back

- **Update:** merge to the default branch; Vercel builds and promotes it.
- **Roll back:** in Vercel's **Deployments** list, open an earlier production deployment and choose **Promote** (or **Instant Rollback**).
