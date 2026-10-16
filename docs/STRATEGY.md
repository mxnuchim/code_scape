# Product strategy

*Status: a working hypothesis, as of 2026-10-15. The landscape facts were checked against the sources linked below on that date. Everything labelled "hypothesis" needs evidence before we act on it.*

## Positioning

> **CodeScape: understand any codebase, find your way around.**
> An explorable map of a repository's architecture, where every claim links to the line of code it comes from. It is available in the browser, and on your machine for private code.

Target users, in priority order:

1. Engineers joining a team or inheriting a system. They need to be productive in days, not weeks.
2. Engineers working with AI coding agents. The agent needs to be grounded in the repository's real structure; the human needs to check what the agent claims.
3. Tech leads and architects who need a current, honest picture of module boundaries and dependencies.

The near-term focus is one developer getting value alone, with no account or server. Team features come later, and only if usage shows they're needed.

## Landscape

| Tool | What it does | Gap relative to CodeScape |
|---|---|---|
| **CodeSee** | Codebase maps. Acquired by GitKraken on 2024-05-14 and folded into its DevEx platform ([GitKraken](https://www.gitkraken.com/blog/gitkraken-launches-devex-platform-acquires-codesee)) | Whether it's still sold standalone is unverified. It is not local-first and has no MCP server. |
| **Sourcegraph Cody / Amp** | Cody's Free and Pro plans ended on 2025-07-23 and it is now enterprise-only ([Sourcegraph](https://sourcegraph.com/blog/changes-to-cody-free-pro-and-enterprise-starter-plans)). Amp is an agentic coding product ([ampcode.com](https://ampcode.com)). | Code search and agents, priced for enterprise. No spatial architecture map. |
| **githubocto/repo-visualizer** | A GitHub Action that renders an SVG of the file tree | Archived (read-only) as of 2026-08-06 ([repo](https://github.com/githubocto/repo-visualizer)). File sizes only, no semantics. |
| **CodeCity** (Wettel, 2007–2009) | The research tool where classes are buildings and packages are districts ([site](https://wettel.github.io/codecity.html)) | A Smalltalk/Moose desktop tool for software metrics. No onboarding, no AI. It is the origin of the city metaphor CodeScape builds on. |
| **Gource** | Animated version-control history, GPL-3.0 ([repo](https://github.com/acaudwell/Gource)) | Shows activity over time, not code structure. |
| **Swark** | A VS Code extension that asks an LLM (via Copilot) to produce Mermaid architecture diagrams, AGPL-3.0 ([repo](https://github.com/swark-io/swark)) | The output is only as good as the LLM, with no parser grounding. The diagrams are static. |
| **DeepWiki** (Cognition) | AI-generated wikis for public repositories, plus a remote MCP server ([docs](https://docs.devin.ai/work-with-devin/deepwiki-mcp)) | Cloud-only. It reflects the last index, not your working tree. Private repositories need an account. |
| **Serena** | An MCP server for symbol-level retrieval and editing via language servers ([repo](https://github.com/oraios/serena)) | Strong agent tooling, but no human-facing map or onboarding narrative. |
| **GitNexus** | A tree-sitter knowledge graph plus a stdio MCP server | Licensed PolyForm Noncommercial (per its npm metadata). Graph-first UI. |
| **CodeViz** | C4 and UML diagrams linked to source, in VS Code and on the web ([codeviz.ai](https://www.codeviz.ai)) | 2D diagrams. No MCP integration mentioned on its homepage. |
| **dependency-cruiser / Madge** | Module dependency validation and graphs for JS/TS (MIT) | JS/TS module level only. No symbols, journeys or AI integration. |

No market sizes or adoption numbers are claimed here; we haven't verified any.

## Why choose CodeScape

What sets it apart is a combination that none of the tools above offers:

1. **One map, shareable to the line.** Every view is a deep link (`?select=…&symbol=…&journey=…`), so "here's how checkout works" is a URL that opens the journey at the right step.
2. **Grounded, not generated.** Structure comes from a parser and binding resolution, not from an LLM summarising files. Every claim carries a basis (fact, static analysis or heuristic), and journeys show gaps instead of plausible inventions.
3. **No account, and local when you need it.** Public repositories work from a link with no install. Private code runs entirely on your machine: it reads your working tree, uncommitted changes included, and makes no network calls. MIT licensed.
4. **Onboarding as a workflow, not a picture.** A reading order with reasons, journeys from entry points to package boundaries, and run and test commands taken from manifests.

The 3D city is the interface, not the point. It earns its place when the map makes a path through the code memorable: you walk a journey, step by step, across buildings you can then find again.

## Adoption plan

1. **Make it a link.** The website works for any public repository with no install or account. The Claude Code integration (MCP server and hosted endpoint) was dropped on 2026-10-16 to focus on the website; private-code users clone the repository and run `codescape view`.
2. **Show it, don't tell it.** A 60-second recording of "I just joined, how does checkout work?": the journey plays in the city, step by step. Use the screenshots in `docs/images/` as a starting point.
3. **Meet people where they work.** Share examples of real, popular open-source repositories with deep links to their journeys.
4. **Ask for help where it's easiest.** Language support is the clearest contribution path: one extractor file plus fixture tests per language.

## Future capabilities

Build only the capabilities whose evidence column turns out to be true.

| Capability | User problem | Data needed | Prerequisites | Complexity | Evidence that would justify it |
|---|---|---|---|---|---|
| More languages (Kotlin, C#, Ruby, PHP; Rust and Java shipped 2026-10-15) | "My repository shows buildings but no edges." | tree-sitter grammars (available) | An extractor and resolver per language | Medium per language | Issues and requests naming a language; the share of analysed repositories in unsupported languages |
| Change-impact view | "What does this change affect?" | The current index plus a diff | Transitive dependency queries (exist in the engine); a diff input | Low–medium | People ask "what breaks if I change this?" |
| Pull-request visualisation | Reviewers can't see where a PR sits in the architecture. | The PR diff, and the base and head indexes | GitHub API or a local branch diff; index comparison | Medium | Demand from reviewers; the change-impact view gets used |
| Git history exploration | "Which parts change together, and who knows them?" | `git log` (read via libgit2 or isomorphic-git, never by running repository hooks) | Safe git reading; time-series layout | Medium–high | Requests for "hotspots" or "ownership" |
| Runtime overlays (OpenTelemetry) | "Which of these paths actually run, and how slow are they?" | OTel traces with code attributes | Mapping spans to symbols; consent and data handling | High | Teams with OTel ask for it. Journeys must stay honest about static versus runtime data. |
| Saved and shared journeys | Seniors want to write down how something works for newcomers. | Journey ids plus annotations | Stable ids (exist) and a storage format (a file in the repository first) | Low–medium | People share deep links; requests for annotations |
| Architecture reports and snapshots | Leads want a periodic picture of how boundaries drift. | Overview and boundaries over time | CI integration; a diff of overviews | Medium | Use in CI; requests from leads |
| Hosted, team and enterprise | Organisation-wide maps; access control | All of the above, centralised | Auth, storage, private repository access, compliance | High | Repeated requests from teams that already use the local tool and will pay |

## Monetisation hypotheses

Not built, and not to be built before there is evidence:

- **Team maps (hypothesis).** Shared, persistent maps with annotations and saved journeys for private repositories. Paid per seat.
- **PR impact in CI (hypothesis).** A GitHub App that comments with the affected modules and journeys, linking into the map.
- **Self-hosted enterprise (hypothesis).** Organisation-wide exploration behind SSO, with runtime overlays.

**How to validate demand cheaply.** Use no telemetry by default: CodeScape promises that nothing leaves the machine. Instead:

1. Track public signals: GitHub stars, issues, and links to cities shared in the wild.
2. Add a "Teams" interest link in the README and the app that leads to a short form (an external page, opt-in).
3. Interview 10–15 engineers who used CodeScape during onboarding, and ask what they would share with their team.
4. Build the smallest paid feature (saved journeys in a hosted space) only if at least 3 teams commit to a pilot.
