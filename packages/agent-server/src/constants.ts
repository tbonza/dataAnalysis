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

export const DEFAULT_THREAD_ID = "default";
