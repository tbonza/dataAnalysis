import { MemorySaver } from "@langchain/langgraph";
import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import { createDeepAgent } from "deepagents";
import { MCP_URL, SERVER_NAME } from "./constants.js";
import { createChatModel } from "./model.js";
import { SKILLS_ROOT, fetchSkills, type SkillFiles } from "./skills.js";

/**
 * The system prompt is deliberately short.
 *
 * Everything substantive — how to shape data, how to choose a chart, how much effort a
 * question deserves — lives in the MCP server's skills, because that is the part that
 * travels to another team's agent. Anything added here would be knowledge this demo
 * has and its consumers don't, which would undercut the thing it is demonstrating.
 */
const SYSTEM_PROMPT = [
  "You are a data analyst. Your capability is the chart MCP server: loading tabular data,",
  "querying it, and turning results into charts.",
  "",
  "Before you author a query spec or a chart spec, read the relevant skill — the skills",
  "list in your context names them, and `read_file` on a skill's path returns it.",
  "Follow the skill you read rather than guessing at the tools' shapes.",
  "",
  "Answer in one or two sentences. State the finding, not the process; the charts speak",
  "for themselves.",
].join("\n");

/**
 * The three calls the `/datasets` and `/prompts` routes need, narrowed the same way
 * `skills.ts`'s `ResourceReader` is — so callers of `AgentBundle` take no type
 * dependency on the MCP SDK beyond what they actually use.
 */
export interface McpToolClient {
  callTool: (params: {
    name: string;
    arguments?: Record<string, unknown>;
  }) => Promise<{ structuredContent?: unknown; content?: unknown[] }>;
  listPrompts: () => Promise<{
    prompts: Array<{ name: string; title?: string; description?: string; _meta?: Record<string, unknown> }>;
  }>;
  /** `prompts/list` carries no message text — the picker needs the real prompt content,
   *  which only `getPrompt` returns, so it renders exactly what Claude Code would. */
  getPrompt: (params: { name: string }) => Promise<{
    messages: Array<{ role: string; content: { type: string; text?: string } }>;
  }>;
}

export interface AgentBundle {
  agent: Awaited<ReturnType<typeof createDeepAgent>>;
  /** Passed into every invocation as the virtual filesystem holding the skills. */
  skillFiles: SkillFiles;
  skillNames: string[];
  toolNames: string[];
  /** For routes that need to call the MCP server directly, with no model involved. */
  mcpClient: McpToolClient;
  close: () => Promise<void>;
}

export async function buildAgent(): Promise<AgentBundle> {
  const mcp = new MultiServerMCPClient({
    mcpServers: { [SERVER_NAME]: { url: MCP_URL } },
  });

  const tools = await mcp.getTools();

  const client = await mcp.getClient(SERVER_NAME);
  if (!client) throw new Error(`Could not reach the MCP server at ${MCP_URL}.`);
  const { files, names } = await fetchSkills(client);

  const agent = await createDeepAgent({
    model: createChatModel(),
    tools,
    systemPrompt: SYSTEM_PROMPT,
    // The skills middleware injects each skill's name and description into the system
    // prompt and lets the agent read the body on demand — the specification's
    // progressive disclosure, which is why the bodies stay out of the prompt.
    skills: [SKILLS_ROOT],
    // deepagents ships a filesystem toolset. The agent needs `read_file` for skills;
    // it has no reason to write, so writing is denied rather than left available.
    permissions: [{ operations: ["write"], paths: ["/**"], mode: "deny" }],
    // Without a checkpointer every request is a fresh run, so a follow-up like "make
    // the bars green" would have no chart to restyle. Keyed by thread id from the
    // client. In memory, so history dies with the process — fine for a demo.
    checkpointer: new MemorySaver(),
  });

  return {
    agent,
    skillFiles: files,
    skillNames: names,
    toolNames: tools.map((tool) => tool.name),
    // `Client`'s real `callTool` return type is a wider union (it also covers a
    // `toolResult`-shaped variant this codebase never produces or reads), which
    // trips TS's weak-type check against our all-optional narrow interface — the
    // same bridge `cli.ts`'s `resultOf` cast makes at its own call site.
    mcpClient: client as unknown as McpToolClient,
    close: () => mcp.close(),
  };
}
