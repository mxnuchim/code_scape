# CodeScape

Paste a public GitHub repository and explore it as a miniature 3D city.

CodeScape reads the repository's real file tree through the GitHub API and builds a city from it. Folders become districts and blocks, files become buildings, and imports traced from the source become transit lines. The same repository always produces the same city.

## Reading the city

| What you see | What it means |
| --- | --- |
| District | A top-level folder, labelled on the ground. Blocks inside it are subfolders. |
| Building | A file. Height follows file size on a log scale. |
| Colour | The file's language, judged from its extension. |
| Shape | The file's role: towers for source, glass-domed labs for tests, silos for config, factories for build and CI, houses for docs, pavilions for styles, warehouses for data, crates for assets. |
| Landmarks | The root README is a town hall, package manifests are clock towers, likely entry points are lighthouses (judged by naming convention only), and the license is a monument. |
| Streets | Separations between folders. They show structure, not dependencies. |
| Transit arcs | Imports read from up to 300 JavaScript, TypeScript and Python files. An arc is drawn only when an import resolves to a real file in the repository. |

Dependencies, build output, caches and lockfiles are left out, and the repository panel lists exactly what was skipped. Very large repositories have their densest folders drawn as single blocks, and a tree that GitHub truncates is flagged as partial.

## Controls

- Drag to orbit, right-drag to pan, scroll to zoom towards the cursor
- `W` `A` `S` `D` to fly, `Q` `E` to turn, `Shift` to go faster
- `/` or `⌘K` to search, `F` to focus the selection, `H` for the whole city, `T` for transit, `Esc` to step back, `?` for help
- On touch screens: drag to orbit, pinch to zoom, two fingers to pan, tap to select

Deep links work: `/<owner>/<repo>` opens that repository's city directly, and `/<owner>/<repo>/tree/<ref>` opens a specific branch or tag.

## Getting started

Requires Node 22 (see `.nvmrc`) and pnpm.

```bash
pnpm install
pnpm dev
```

Then open http://localhost:3000.

Other scripts:

```bash
pnpm test        # unit tests (Vitest)
pnpm typecheck   # TypeScript
pnpm lint        # ESLint
pnpm build       # production build
```

## How it works

There is no backend. The browser calls `api.github.com` and `raw.githubusercontent.com` directly, so every visitor gets their own unauthenticated rate limit (60 API requests an hour). A city costs about two API requests. Import tracing reads raw files, which doesn't count against that limit. When the limit is reached, CodeScape offers a dated snapshot of `pallets/flask` that ships with the app (`public/samples/`, regenerated with `node scripts/snapshot-sample.mjs owner/repo`).

```
src/
  lib/github/     URL parsing, API client and error classification
  lib/analysis/   file classification, exclusions, the repository model, import tracing
  lib/layout/     deterministic city layout (squarified treemap), pure TypeScript
  state/          zustand store and the loading pipeline
  components/world/   React Three Fiber scene: buildings, districts, camera, effects
  components/ui/      landing, loading and error states, HUD, panels, search
```

Each layer only depends on the ones above it. Analysis knows nothing about rendering, and the layout produces plain numbers that the 3D world draws.

Built with Next.js, React Three Fiber, drei, postprocessing, Tailwind CSS, Motion and zustand.
