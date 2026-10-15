/**
 * The CodeScape MCP server: read-only code understanding, using the same
 * analysis engine as the web app. `createCodescapeServer` serves a checkout on
 * this machine over stdio; `src/mcp/remote.ts` serves public GitHub
 * repositories from the website. Both register the same tools here.
 */
import * as z from "zod/v4";
import { McpServer } from "@modelcontextprotocol/server";
import { LocalWorkspace, type LocalWorkspaceOptions } from "../lib/local/workspace";
import { createViewerLauncher, type ViewerLauncher } from "../cli/viewer";
import type { ToolContext } from "./context";
import { registerOverview } from "./tools/overview";
import { registerFindCode } from "./tools/findCode";
import { registerExplainModule } from "./tools/explainModule";
import { registerDependencies } from "./tools/dependencies";
import { registerTracePath } from "./tools/tracePath";
import { registerOnboarding } from "./tools/onboarding";
import { registerOpenViewer } from "./tools/openViewer";

export const SERVER_NAME = "codescape";
export const SERVER_VERSION = "0.2.0";

export function serverInstructions(root: string): string {
  return instructions(`CodeScape analyses the local repository at ${root} (and nothing else). It reads files and does not run any of them. No source code leaves this machine.`);
}

/** Instructions for the hosted server, which reads one public GitHub repository. */
export function remoteServerInstructions(fullName: string): string {
  return instructions(
    `CodeScape analyses the public GitHub repository ${fullName} (and nothing else), reading its files from GitHub at the default branch unless a ref was given. It never runs any code. It cannot see local changes or private repositories.`,
  );
}

function instructions(scope: string): string {
  return [
    scope,
    "",
    "When to use it: orienting in an unfamiliar codebase. Typical questions are what this project is, where to start reading, how a request or operation flows, what depends on a file, and where something is implemented.",
    "",
    "Suggested flow:",
    "1. get_codebase_overview gives project type, modules, entry points, commands and detected code journeys.",
    "2. find_code locates declarations, files or text. It returns path:line and symbol ids.",
    "3. explain_module gathers evidence about a file, folder or symbol. Explain it in your own words from that evidence.",
    "4. get_dependencies covers upstream and downstream; use depth 2-3 for change impact.",
    "5. trace_code_path follows an operation, e.g. 'POST /users', through resolved calls, with gaps stated.",
    "6. get_onboarding_guide gives a reading order with reasons, plus run and test commands.",
    "7. open_in_codescape returns a link to that location in the 3D map. Offer it when a visual would help.",
    "",
    "Honesty rules:",
    "- Every claim carries a basis. 'fact' comes from files or manifests. 'static-analysis' comes from parsed and resolved code. 'heuristic' comes from names or structure.",
    "- Pass these labels on, and never present a heuristic role as fact.",
    "- Cite path:line from the results.",
    "- Relationships are static. Runtime behaviour, dynamic dispatch and dependency injection are not visible, and the tools report gaps rather than guessing.",
    "- If a tool says a file was not parsed, say so instead of assuming it has no dependencies.",
  ].join("\n");
}

export interface CreateServerOptions {
  root: string;
  workspace?: LocalWorkspaceOptions;
  viewer?: ViewerLauncher;
}

export async function createCodescapeServer(options: CreateServerOptions): Promise<{ server: McpServer; context: ToolContext }> {
  const workspace = await LocalWorkspace.open(options.root, options.workspace);
  const viewer = options.viewer ?? createViewerLauncher(workspace.root);
  const context: ToolContext = { workspace, viewer, mode: "local" };
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION, title: "CodeScape" }, { instructions: serverInstructions(workspace.root) });
  registerCodescape(server, context);
  return { server, context };
}

/** Register CodeScape's tools, resource and prompts on `server` for one workspace. */
export function registerCodescape(server: McpServer, context: ToolContext): void {
  const { workspace } = context;
  registerOverview(server, context);
  registerFindCode(server, context);
  registerExplainModule(server, context);
  registerDependencies(server, context);
  registerTracePath(server, context);
  registerOnboarding(server, context);
  registerOpenViewer(server, context);

  // A readable overview that can be attached to a conversation with @codescape:codescape://overview
  server.registerResource(
    "overview",
    "codescape://overview",
    { title: "Repository overview", description: "Project type, modules, entry points, commands, journeys and analysis limits.", mimeType: "text/markdown" },
    async (uri) => {
      const { analysis } = await workspace.get();
      const o = analysis.overview;
      const md = [
        `# ${o.name}`,
        "",
        `**Type (${o.projectType.basis}):** ${o.projectType.label} — ${o.projectType.reasons.join("; ")}`,
        o.description ? `\n${o.description.text}\n` : "",
        "## Modules",
        ...o.modules.map((m) => `- \`${m.path || "(root)"}\` — ${m.files} files${m.role ? `, ${m.role.label} (${m.role.basis})` : ""}`),
        "",
        "## Entry points",
        ...o.entryPoints.slice(0, 12).map((e) => `- \`${e.path}\` — ${e.label} (${e.basis}, ${e.evidence.path}:${e.evidence.startLine})`),
        "",
        "## Code journeys",
        ...analysis.journeys.slice(0, 12).map((j) => `- ${j.title} — \`${j.id}\``),
        "",
        "## Reading order",
        ...analysis.onboarding.readingOrder.map((r) => `${r.order}. \`${r.path}${r.line ? `:${r.line}` : ""}\` — ${r.reason}`),
        "",
        "## Limitations",
        ...o.limitations.map((l) => `- ${l}`),
      ].join("\n");
      return { contents: [{ uri: uri.href, mimeType: "text/markdown", text: md }] };
    },
  );

  server.registerPrompt(
    "onboard",
    {
      title: "Onboard me to this repository",
      description: "Guided orientation: overview, reading order, one code journey, and how to run and test.",
      argsSchema: z.object({ focus: z.string().optional().describe("Optional folder or area to focus on") }),
    },
    ({ focus }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: [
              `Help me get oriented in this repository${focus ? `, focusing on ${focus}` : ""}.`,
              `Use the CodeScape tools: get_codebase_overview, then get_onboarding_guide${focus ? ` with focus "${focus}"` : ""}, then trace_code_path on the representative journey.`,
              "Explain what the system does, how it is organised, where execution enters, and one path through the code.",
              "Then give me a short reading order and the commands to run and test it.",
              "Cite path:line for every claim, and keep facts, static-analysis findings and heuristics distinct.",
              "Finish with a link from open_in_codescape to the most useful starting point.",
            ].join(" "),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "investigate",
    {
      title: "Investigate how something works",
      description: "Answer a question about the code with evidence: locate, trace, check dependencies.",
      argsSchema: z.object({ question: z.string().describe("What you want to understand, e.g. 'how are payments captured?'") }),
    },
    ({ question }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: [
              `Question about this codebase: ${question}`,
              "Use CodeScape's find_code to locate the relevant code and trace_code_path to follow the operation. Use get_dependencies to check what else is involved, and explain_module for the key pieces.",
              "Answer with the sequence of files and functions involved and path:line citations.",
              "Say clearly where the static trail goes cold (gaps) instead of filling them in.",
              "Offer an open_in_codescape link to the journey or main file.",
            ].join(" "),
          },
        },
      ],
    }),
  );
}
