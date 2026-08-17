import { SKILL_FILENAME, SKILLS_ROOT, SKILL_URI_PREFIX } from "./constants.js";

/**
 * Load the agent's skills from the MCP server, not from disk.
 *
 * This is the point of the arrangement: the agent ships a system prompt and nothing
 * else, and everything it knows about querying and charting comes from the tool it is
 * pointed at. Another team's agent gets the same instructions by reading the same
 * resources.
 */

/** deepagents' virtual-filesystem file shape: content is an array of lines. */
export interface FileData {
  content: string[];
  created_at: string;
  modified_at: string;
}

export type SkillFiles = Record<string, FileData>;

export { SKILLS_ROOT };

/**
 * `chart://skill/data-query` becomes `/skills/data-query/SKILL.md`, and
 * `chart://skill/data-query/references/query-spec.md` keeps its relative position so
 * the links inside a skill body still resolve.
 */
function pathForUri(uri: string): string | undefined {
  if (!uri.startsWith(SKILL_URI_PREFIX)) return undefined;
  const rest = uri.slice(SKILL_URI_PREFIX.length);
  if (!rest) return undefined;
  const slash = rest.indexOf("/");
  return slash === -1
    ? `${SKILLS_ROOT}${rest}/${SKILL_FILENAME}`
    : `${SKILLS_ROOT}${rest.slice(0, slash)}/${rest.slice(slash + 1)}`;
}

function textOf(contents: Array<{ text?: unknown; blob?: unknown }>): string {
  return contents
    .map((entry) => (typeof entry.text === "string" ? entry.text : ""))
    .filter(Boolean)
    .join("\n");
}

export interface LoadedSkills {
  files: SkillFiles;
  /** Skill names, for logging — the agent discovers them through the middleware. */
  names: string[];
}

/**
 * Only the two resource methods we need, so this module doesn't depend on the MCP SDK
 * package directly — the adapter hands us the client already constructed.
 */
export interface ResourceReader {
  listResources: () => Promise<{ resources: Array<{ uri: string }> }>;
  readResource: (params: { uri: string }) => Promise<{ contents: unknown[] }>;
}

export async function fetchSkills(client: ResourceReader): Promise<LoadedSkills> {
  const { resources } = await client.listResources();
  const skillResources = resources.filter((resource) => pathForUri(resource.uri) !== undefined);

  const stamp = new Date().toISOString();
  const files: SkillFiles = {};
  const names = new Set<string>();

  for (const resource of skillResources) {
    const path = pathForUri(resource.uri);
    if (path === undefined) continue;
    const read = await client.readResource({ uri: resource.uri });
    const text = textOf(read.contents as Array<{ text?: unknown }>);
    if (!text) continue;

    files[path] = {
      // deepagents stores files as lines, and reads them back the same way.
      content: text.split("\n"),
      created_at: stamp,
      modified_at: stamp,
    };
    if (path.endsWith(`/${SKILL_FILENAME}`)) {
      names.add(path.slice(SKILLS_ROOT.length, -`/${SKILL_FILENAME}`.length));
    }
  }

  return { files, names: [...names].sort() };
}
