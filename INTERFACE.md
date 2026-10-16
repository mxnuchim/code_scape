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
4. **Navigation never fights the user.** Fly-tos are short and eased, and the user can interrupt them. There is always a way back: `Esc` steps back, `H` (and the Home button) returns to the opening view.
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

## Camera and controls
- **Opening view.** Every city opens on a low three-quarter aerial shot: about 22° above the horizon (`OPENING_ELEVATION`), looking diagonally across the island from the +X/+Z corner, turned a little off the exact diagonal. `aerialView()` (`src/lib/camera/aerialView.ts`) fits the island and every building top exactly into the frame, so a 5-building repo and a 10,000-building one are framed the same way. Never use fixed distances for framing.
- **What it keeps clear:** the top bar, the bottom controls, the guide sheet (left, ≥ 640 px) and any right panel or phone sheet. While nobody has moved the camera since the opening view, it re-frames when those panels open or close.
- **Portrait screens** frame the built-up area, not the whole island, and put the spare height above the city, where the sea, horizon and sky show.
- **Fly-in:** about 1.1 s from the loading orbit, taking the short way round. Under reduced motion it is a cut. A deep link (`?select=`, `?journey=`) is applied after assembly and flies on from the opening view, so it always wins. Home, `H`, `0` and `Esc` with nothing open return to the same view.
- **Fog, sky and far plane follow the camera distance,** so a tall phone frame or a full zoom-out never sinks the city into haze or leaves the sky dome.
- **Limits:** tilt from almost straight down (0.02 rad) to just above the rooftops (1.42 rad); never below the ground. The orbit pivot stays over the island plus 30% of its size of sea. Zoom out stops a little past the opening view.
- **Mouse:** left-drag orbits (vertical drag tilts); right-drag or shift + left-drag pans across the ground like a map; the wheel zooms towards the cursor.
- **Touch:** one finger orbits and tilts; two fingers pan and pinch to zoom; three fingers pan.
- **Keyboard** (by physical key, `KeyboardEvent.code`): WASD / arrows move relative to the view, Q/E turn, R/F and PageUp/PageDown tilt, +/− zoom, Shift is faster. Movement keys are ignored while a text field, a dialog, the file tree, a list, tabs or a menu has focus.
- **Shortcut map:** `/` search, `?` help, `G` guide, `T` import flows, `C` focus the selection, `H`/`0` opening view, `[` `]` journey steps, `Esc` step back. `F` used to focus the selection; it is now tilt, as in most 3D map controls, and focusing moved to `C`.
- The Help panel's "Getting around" lists every control in Mouse / City / Keyboard columns (touch screens get the touch list). The one-time hint names the essentials and points to `?`.

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

## 2026-10-15 18:31 WAT — "Ask Claude about it"
- **GitHub cities offer the Claude connection in the repository panel**, right after the Repository facts: one line of explanation, the full `claude mcp add --transport http codescape-<repo> "<site>/api/mcp/<owner>/<repo>"` command in a wrapped mono block (`bg-black/30`, hairline ring, like source excerpts), and two quiet buttons: **Copy command** and **Copy server URL**. Local cities don't show it, because the local MCP server is set up from the terminal.
- **The command is literal and safe to paste:** the URL is quoted (zsh), the server name is `codescape-<repo>` slugged, and `?ref=` is added only when the city isn't on the default branch.
- **Copy buttons share one component** (`CopyButton` in `common.tsx`), labelled with what they copy ("Copy path", "Copy command") and confirming with "Copied" for 1.4 s.
- **The footnote states the limit:** public repositories only; private code runs locally.

### 2026-10-15 19:10 WAT — Repository library (`LibraryPanel`)
- **The landing card leads with famous codebases.** "Start with a famous codebase" shows five headline picks (`FEATURED` in `src/lib/repoLibrary.ts`) as chips with the owner's GitHub avatar and a product name ("X's algorithm", "Docker"). An accent text button, "Browse all 50", opens the library. The old dull samples (flask, zustand, express, vite) are gone.
- **The library is a modal dialog**, not a `Sheet`: it has its own search field and a long list, so it needs a focus trap. It slides in from the right on desktop (460 px, full height) and up from the bottom on phones (full height, 8 px inset), over a `bg-black/45` scrim. It is `panel: "library"` in the store, so Esc and the other panels behave as they do for Help.
- **Layout:** header (eyebrow, title, one line of copy, close), search field, category chips (`aria-pressed`), then the list grouped by category with sticky category headers, then a footer legend. Each entry is one `row-btn`: avatar, product name, `owner/repo` in mono, a one-line hook, then language swatch · file count · depth badge.
- **Depth badges say what the browser will show**, derived from measured counts by `analysisHint()`:
  - FULL ANALYSIS (hairline white): every parseable file fits in the browser's 300-file budget.
  - PARTIAL (faint hairline): more than 300 parseable files, a truncated listing, or mostly an unparsed language with some parsed files.
  - MAP ONLY (dashed): mostly an unparsed language (C, for example); structure only, no imports traced.
  The full sentence is in the badge's `title` and in the entry's screen-reader description.
- **Honesty rules for the library:** only real, public, unarchived repositories; never a closed product (Instagram, Snapchat, the Facebook app). "The code behind" only where literally true, and dated when it may be stale ("as X published them in 2023"). File counts come from CodeScape's own model, so they match the city; a truncated listing shows "≥" and "listing truncated". The footer says when and how counts were measured.
- **Keyboard:** focus starts in search (on touch screens the dialog itself takes focus, so the keyboard doesn't cover the list); ↓/↑ move between entries and back to search; Tab is trapped; Esc closes. Search and filter reset each time the dialog opens.
- **Gotcha:** don't put `backdrop-filter` (or a fading `opacity`) on the scrim. Either makes the scrim a backdrop root, and the panel's glass then shows the page behind it unblurred.

### 2026-10-15 23:49 WAT — Opening aerial view and richer navigation
- Cities open on a fitted low three-quarter aerial view (about 22°) instead of a 57°-from-vertical framing of the built area; see "Camera and controls" above. 22° rather than 30° so the horizon haze shows above the island on a landscape screen with our 30° field of view; at 25° and above the top of the frame is only sea.
- Pans slide across the ground (`SCREEN_PAN`) rather than in the screen plane, so the pivot never lifts off the map.
- `F` is now tilt and "focus the selection" moved to `C`; the inspector's Focus button title says so.
- Global shortcuts other than `Esc` and `?` wait while focus is inside a dialog.

### 2026-10-16 01:04 WAT — Claude Code integration removed
- The repository panel no longer has the "Ask Claude about it" section (the 2026-10-15 18:31 entry above is superseded), and the guide's "Questions to explore" no longer points to Claude Code. The landing hint for private code now says to run `codescape view --root .` from a clone. Don't mention Claude Code or MCP in the product UI.
