import type { McpToolClient } from "./agent.js";
import { RECOMMENDED_PROMPT_KIND } from "./constants.js";

/**
 * The prompt library and dataset catalog, read from MCP and reshaped for the web client.
 *
 * Split out of `server.ts` so routing and library shaping stay separate concerns, and so
 * `roles.ts` can reuse the same "which prompts are library prompts" rule instead of
 * repeating the `_meta` check.
 */

/** One prompt registration carrying the library's `_meta`. */
type ListedPrompt = Awaited<ReturnType<McpToolClient["listPrompts"]>>["prompts"][number];

export interface GroupedPrompts {
  dataset: string;
  /** The catalog's description of the dataset, minus its agent-routing "Use when…"
   *  clause; empty if the catalog lacks it. */
  description: string;
  roles: Array<{
    role: string;
    roleSlug: string;
    /** One user-facing paragraph on the role — shown under the role name. */
    description: string;
    prompts: Array<{ name: string; title: string; text: string }>;
  }>;
}

/** The text blocks of a tool result, concatenated. */
function textOf(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .map((part) =>
      part && typeof part === "object" && (part as { type?: string }).type === "text"
        ? String((part as { text?: unknown }).text ?? "")
        : ""
    )
    .join("");
}

/** Pull the structured payload out of a tool result, falling back to text blocks —
 *  the same fallback mcp-server's own `cli.ts` uses. */
export function resultOf(result: { structuredContent?: unknown; content?: unknown[] }): unknown {
  if (result.structuredContent !== undefined) return result.structuredContent;
  return textOf(result.content);
}

/** The registrations that belong to the executive prompt library, as opposed to the
 *  per-skill loader prompts the server also exposes. One definition of the rule, used by
 *  both the picker payload and the role allow-list. */
export function recommendedPrompts(prompts: ListedPrompt[]): ListedPrompt[] {
  return prompts.filter((prompt) => prompt._meta?.["kind"] === RECOMMENDED_PROMPT_KIND);
}

/** Skill and dataset descriptions are written for an agent and end with a routing
 *  clause ("… Use when a question is about …"). The picker wants only the part before
 *  it: what the thing *is*. */
function userFacing(description: string): string {
  const cut = description.search(/\bUse (when|before|whenever)\b/i);
  return (cut === -1 ? description : description.slice(0, cut)).trim();
}

/** `list_available_datasets`' catalog as a name -> description map. Anything that isn't
 *  the expected `{ datasets: [{ name, description }] }` shape yields an empty map, so a
 *  catalog hiccup thins the picker's captions rather than failing the whole route. */
async function datasetDescriptions(client: McpToolClient): Promise<Map<string, string>> {
  const raw = resultOf(await client.callTool({ name: "list_available_datasets", arguments: {} }));
  const out = new Map<string, string>();
  if (typeof raw !== "object" || raw === null) return out;
  const list = (raw as { datasets?: unknown }).datasets;
  if (!Array.isArray(list)) return out;
  for (const entry of list as Array<{ name?: unknown; description?: unknown }>) {
    if (typeof entry.name === "string" && typeof entry.description === "string") {
      out.set(entry.name, userFacing(entry.description));
    }
  }
  return out;
}

/** The first text block of a `getPrompt` result — the same text `promptNameFor`'s
 *  registration on the MCP server hands to a model, so the picker inserts exactly
 *  what running the prompt in Claude Code would. */
function firstTextOf(result: { messages: Array<{ content: { type: string; text?: string } }> }): string {
  const block = result.messages.find((message) => message.content.type === "text");
  return block?.content.text ?? "";
}

/** `listPrompts()`'s recommended-prompt entries, with each one's real text fetched via
 *  `getPrompt`, grouped dataset -> role -> prompt — the shape the web picker renders. */
export async function groupPrompts(client: McpToolClient): Promise<GroupedPrompts[]> {
  const { prompts } = await client.listPrompts();
  const recommended = recommendedPrompts(prompts);
  const descriptions = await datasetDescriptions(client);

  const byDataset = new Map<string, Map<string, GroupedPrompts["roles"][number]>>();

  // Sequential rather than Promise.all: keeps each role's prompts in the library's
  // authored order instead of whichever `getPrompt` call happens to resolve first.
  for (const prompt of recommended) {
    const meta = prompt._meta ?? {};
    const dataset = meta["dataset"];
    const role = meta["role"];
    const roleSlug = meta["roleSlug"];
    const roleBrief = meta["roleBrief"];
    if (typeof dataset !== "string" || typeof role !== "string" || typeof roleSlug !== "string") continue;

    const text = firstTextOf(await client.getPrompt({ name: prompt.name }));

    let roles = byDataset.get(dataset);
    if (!roles) {
      roles = new Map();
      byDataset.set(dataset, roles);
    }
    let entry = roles.get(roleSlug);
    if (!entry) {
      entry = {
        role,
        roleSlug,
        description: typeof roleBrief === "string" ? roleBrief : "",
        prompts: [],
      };
      roles.set(roleSlug, entry);
    }
    entry.prompts.push({ name: prompt.name, title: prompt.title ?? prompt.name, text });
  }

  return [...byDataset.entries()].map(([dataset, roles]) => ({
    dataset,
    description: descriptions.get(dataset) ?? "",
    roles: [...roles.values()],
  }));
}
