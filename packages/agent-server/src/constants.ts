/**
 * Every tunable and shared identifier for this package, in one place.
 */

// --- HTTP -----------------------------------------------------------------

export const DEFAULT_AGENT_PORT = 3001;
export const DEFAULT_HOST = "127.0.0.1";

export const AGENT_PORT = Number(process.env["AGENT_PORT"] ?? DEFAULT_AGENT_PORT);
export const HOST = DEFAULT_HOST;

/** The web client runs on a different port, so CORS needs an explicit allowance.
 *  Must match web-client's own dev port (`vite.config.ts`). */
export const CLIENT_ORIGIN = process.env["CLIENT_ORIGIN"] ?? "http://127.0.0.1:5173";

export const HEALTH_PATH = "/health";
export const CHAT_PATH = "/chat";
export const DATASETS_PATH = "/datasets";
export const PROMPTS_PATH = "/prompts";

// --- the MCP server this agent talks to ------------------------------------

export const MCP_URL = process.env["MCP_URL"] ?? "http://127.0.0.1:3000/mcp";

/** The name mcp-server's `MCP_SERVER_NAME` registers itself under. Duplicated
 *  by design — the two packages are coupled by deployment, not by code. */
export const SERVER_NAME = "chart";

// --- model ------------------------------------------------------------------

// Bedrock model IDs are provider-prefixed and differ from first-party Anthropic
// API IDs. Per aws-bedrock-foundation-models.json (and `bedrock
// list-foundation-models`), `anthropic.claude-sonnet-5` is ACTIVE but
// INFERENCE_PROFILE-only, so it must be invoked through the cross-region profile
// ID (`us.` prefix); the bare `anthropic.claude-sonnet-5` is rejected with
// "Invocation of model ID ... with on-demand throughput isn't supported".
export const BEDROCK_MODEL_ID = process.env["BEDROCK_MODEL_ID"] ?? "us.anthropic.claude-sonnet-5";
export const AWS_REGION = process.env["AWS_REGION"] ?? process.env["AWS_DEFAULT_REGION"] ?? "us-east-1";

// --- skills -------------------------------------------------------------------

/** Where the deepagents skills middleware is told to look in its virtual filesystem. */
export const SKILLS_ROOT = "/skills/";

/** Resource URI scheme for skills. Duplicated in mcp-server's own `constants.ts`,
 *  which is the module that mints these URIs — this package only parses them. */
export const SKILL_URI_PREFIX = "chart://skill/";

export const SKILL_FILENAME = "SKILL.md";

/** Marks a registered MCP prompt as part of the executive prompt library, distinct
 *  from the per-skill loader prompts. Duplicated from mcp-server's own
 *  `constants.ts`, which mints the tag — this package only reads it. */
export const RECOMMENDED_PROMPT_KIND = "recommended-prompt";

// --- agent behaviour ------------------------------------------------------

/** Ceiling on the deepagents graph's step count for a single turn. */
export const RECURSION_LIMIT = 50;

/**
 * The graph node that calls the model — langchain's own `AGENT_NODE_NAME`
 * (`langchain/dist/agents/nodes/AgentNode.js`). Token deltas are filtered to it so a
 * middleware model call can't leak into the answer.
 *
 * Deliberately not load-bearing: if langchain renames the node, the filter matches
 * nothing and `streamChat` falls back to emitting each message's text whole, exactly as
 * it did before token streaming. A rename costs the typewriter effect, not the answer.
 */
export const MODEL_NODE_NAME = "model_request";

/** Longest `detail` string a `tool` SSE event carries (a tool call's JSON arguments,
 *  truncated) — enough to read what a call did, small enough for `load_data` rows. */
export const TOOL_DETAIL_MAX_CHARS = 400;

export const DEFAULT_THREAD_ID = "default";

// --- SSE, through a buffering proxy ---------------------------------------

/**
 * Bytes of SSE comment written before the first real event.
 *
 * A reverse proxy that buffers to a fixed threshold holds a stream until it has that
 * many bytes, which turns a live turn into one delivery at the end. Crossing the
 * threshold up front makes the proxy start flushing. The client ignores comment frames
 * (they carry no `data:` line), so this costs one wasted packet and nothing else.
 */
export const SSE_PADDING_BYTES = 2048;

/** How often to write a keep-alive comment while a turn is in flight. Stops an idle
 *  timeout from cutting a long tool call, and keeps bytes moving through a proxy that
 *  only flushes on write. */
export const SSE_HEARTBEAT_MS = 15_000;

/**
 * Headers that keep a stream a stream across intermediaries.
 *
 * `no-transform` forbids a proxy from gzipping the response — compression buffers by
 * nature. `x-accel-buffering` is the nginx family's opt-out from response buffering;
 * other proxies ignore it, which is why the padding and heartbeat above exist too.
 */
export const SSE_HEADERS = {
  "content-type": "text/event-stream",
  "cache-control": "no-cache, no-transform",
  connection: "keep-alive",
  "x-accel-buffering": "no",
} as const;

/** Longest role name `/chat` will accept. The library's own names ("Chief Executive
 *  Officer") are well under this; the cap exists so a client can't push an essay into
 *  the framing sentence. */
export const ROLE_MAX_CHARS = 80;

/** Prefixed to a turn when the client names a role, so `job-roles` fires — its SKILL.md
 *  only applies a persona when "the user tells you which role they're speaking as". */
export function roleFraming(role: string): string {
  return `I'm asking as the ${role}. Frame the answer for that role.`;
}
