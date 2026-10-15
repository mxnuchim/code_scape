# Interface decisions

The design record for CodeScape. Read it before building UI, and follow it. When you make a new decision, append it to the decision log at the bottom with a timestamp, and update the rules above it if the decision changes them.

## Principles
1. **The city is expressive. The interface is an instrument.** Panels, labels and controls should read as a precise engineering tool: graphite surfaces, hairline borders, compact type, a single accent colour.
2. **Every visual channel has one documented meaning.** If a channel has no data behind it, it's decoration, and we say so: lit windows, streetlights, trees and the landing village are all decoration.
3. **Honest about data.** Every claim carries a basis:
   - **Fact:** read directly from the tree or a manifest.
   - **Static analysis:** found by parsing source.
   - **Heuristic:** naming conventions or inference.

   Runtime behaviour is never implied. Nothing animates as if it were traffic.
4. **Navigation never fights the user.** Fly-tos are short and eased, and the user can interrupt them. There is always a way back: `Esc` steps back, `H` returns to the overview.
5. **Respect reduced motion** in both layers: the 3D scene snaps instead of easing, and UI springs are disabled.

## Tokens (`src/app/globals.css`)
| Token | Value | Use |
|---|---|---|
| `--ink` / `--ink-soft` / `--ink-faint` | #e8e9eb / #a4a8b0 / #6e737c | Primary, secondary and tertiary text |
| `--panel` / `--panel-strong` | rgba(16,18,22,.78) / .92 | Glass panels and opaque sheets |
| `--line` / `--line-strong` | white at 8% / 16% | Hairline borders and dividers |
| `--accent` (amber) | #f5a524 | Selection, primary action, outgoing imports |
| `--teal` | #3cc6b8 | Incoming imports ("imported by") |
| `--danger` | #f07a5f | Errors |
| journey violet (`WORLD.journey`) | #9d8cff | Code journeys only: arcs, numbered stops, route icons. Never reused for anything else. |

Rules:
- Use small radii.
- Use one accent colour per view.
- Never add a new colour without recording it here.

## Typography
- **Sans:** Geist. **Mono:** Geist Mono. Mono is used for paths, symbols, line numbers, counts and keyboard hints.
- **Base size** is 14px.
- **Eyebrows** (`.eyebrow`) are uppercase mono micro-labels for section headers.
- **3D labels** use `/fonts/geist-mono-500.woff` and `/fonts/geist-600.woff`.
- **Copy** is technical and literal. Avoid whimsical metaphors in status text: say "Fetching file tree", not "Surveying the land".

## Visual mapping (the city legend)
| Channel | Meaning | Basis |
|---|---|---|
| District / plate | Folder; top-level folders are labelled districts | Fact |
| Building | One file; a large folder may be drawn as a single block | Fact |
| Height | File size on a log scale, comparable within the same building shape. Each style may stretch heights but always preserves their order. | Fact |
| Shape | File role: source, test, config, build, docs, style, data, asset or other | Heuristic (by name and extension) |
| Language band and lens | Language, judged from the extension | Heuristic |
| Landmarks | README, manifest, licence, entry point. An entry-point beacon is either verified from a manifest or route convention, or naming-only. | Fact / Heuristic |
| Arcs (amber out / teal in) | Import edges of the selected building that resolve to a real file. They are static lines with an arrowhead at the target. | Static analysis |
| Journey (violet) | Numbered stops on the buildings a journey passes through, and static arcs from caller to callee. A dashed line rising out of a building, labelled with a package name, means a call leaves the repository. | Static analysis |
| District flows | Aggregated import counts between top-level folders | Static analysis |
| Windows, streetlights, trees, clouds | Decoration only | — |

Interaction colours (`WORLD` in `src/theme/palette.ts`): hover is white, selection is amber, outgoing is amber, incoming is teal, and anything dimmed is grey #7b7f86.

## Motion
- UI uses `motion/react` springs for panels and sheets. Keep them short, about 200–300 ms.
- The 3D scene uses the existing channels (rise, pop, dim), driven by eased per-frame updates.
- Do not use marching dashes or moving particles on dependency lines. Dashes mean "uncertain or leaving the repo", and never mean motion.
- `MotionConfig reducedMotion="user"` wraps the app, so UI springs follow the OS setting. The 3D scene reads `reducedMotion` from the store.

## Decision log

### 2026-10-15 14:06 WAT — Seeded from the existing implementation
- Recorded the current graphite and amber token set, the Geist typography and the visual mapping above.
- Flagged for change:
  - The loading copy ("Reading the deed", "Surveying the land") is whimsical; it should be literal.
  - The selection arcs use marching dashes, which imply traffic.
  - The InfoPanel's "Building types" bar uses colours that don't match `CATEGORY_COLORS`.

### 2026-10-15 15:18 WAT — Evidence, guide, journeys and inspection (M4/M5)
- **Basis badges** (`Evidence.tsx`, `BasisBadge`) appear on every inferred claim. They are mono uppercase micro-labels:
  - FACT: hairline white
  - STATIC: teal outline
  - HEURISTIC: dashed amber outline

  Each has a title that says what it means. Never show an inference without one.
- **Location references** (`LocLink`): a mono `path:line` with a dotted underline. Clicking it selects the building; a small ↗ opens the real source (GitHub `#Lx-Ly`, or `vscode://file…:line` for local repositories). Use it for every file reference in panels.
- **Source excerpts** (`SourceExcerpt`): a numbered, read-only mono block on `bg-black/30` with a hairline ring, capped at 80 lines and always redacted.
- **Panel layout:**
  - The guide is the left sheet; it opens automatically once per city after assembly, on screens ≥ 1024 px.
  - The inspector is the right sheet.
  - Both stay open together on desktop. On phones (< 640 px) only one sheet shows at a time (`togglePanel`, `select`).
- **Journey bar:** bottom-centre on desktop, padded clear of whichever side panels are open; under the top bar on phones. `[` and `]` step through the journey, Esc leaves it. Starting a journey on screens < 1280 px closes the guide.
- **Copy is literal.** Loading steps read "Repository details / File tree / Classifying files / Building the city". Error titles state the problem ("Repository not found or private"), and any copy about the 3D world is honest about decoration ("the town behind this card is illustrative").
- **Accessibility:**
  - Side sheets are non-modal `role="region"`.
  - Search and Help are `role="dialog" aria-modal` with `useFocusTrap`.
  - The keyboard file tree (`FileTree`, in the guide's Files tab) is the accessible path to every file.
  - The live region announces selections and journey steps.
  - Panel text is selectable.
- **The legend panel is hidden while a left panel is open**, so the two never overlap.

## 2026-10-15 18:06 WAT — Supported-language copy and runtime-dispatch gaps
- **Language lists in UI copy come from one place.** `PARSED_LANGUAGES_AND` / `PARSED_LANGUAGES_OR` in `src/lib/analysis/languages.ts` ("JavaScript, TypeScript, Python, Go, Rust and Java"). HelpPanel, RepoPanel, InfoPanel, GuidePanel and the HUD use them; never hard-code a language list again (the HUD and InfoPanel had drifted and left out Go).
- **A call on an interface or trait shows as a journey gap**, not a dead end and not a guessed implementation: the step lands on the declaration, and the journey bar shows the amber ⚠ gap line ("…is declared on an interface; the implementation is chosen at runtime and isn't followed") with its `path:line`. Same visual as other gaps.
- **Route and main labels name the language's convention**: "spring route", "axum route", "rust-attribute route", and entry points read "`fn main` in a binary crate root" / "`public static void main` method".
