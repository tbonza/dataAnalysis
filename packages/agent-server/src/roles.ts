import type { McpToolClient } from "./agent.js";
import { ROLE_MAX_CHARS, roleFraming } from "./constants.js";
import { recommendedPrompts } from "./library.js";

/**
 * Turning a client-supplied role name into a framing sentence for the model.
 *
 * Kept out of `server.ts` on purpose: that module calls `buildAgent()` and `listen()` at
 * module scope, so nothing in it can be imported from a test. Everything here is pure
 * apart from `knownRoles`, which memoizes one MCP round trip.
 */

/**
 * A role name the framing sentence can safely carry: single-line, trimmed, bounded.
 * Anything else becomes "" and the turn goes through unframed — the client sent
 * something the picker could not have produced.
 */
export function sanitizeRole(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > ROLE_MAX_CHARS) return "";
  if (/[\r\n]/.test(trimmed)) return "";
  return trimmed;
}

/** The turn as the model sees it. An empty role leaves the message exactly as typed. */
export function frameMessage(message: string, role: string): string {
  return role ? `${roleFraming(role)}\n\n${message}` : message;
}

/** Keyed by client rather than held in a module-level variable, so the memo lives
 *  exactly as long as the bundle that owns the connection — and so tests can get a
 *  fresh cache by passing a fresh stub. */
const cache = new WeakMap<McpToolClient, Promise<Set<string>>>();

/**
 * The role names the prompt library actually defines, read from the same
 * `_meta["role"]` field `groupPrompts` reads. Memoized: the library is built once at
 * MCP startup and cannot change under a running server, so re-listing prompts on every
 * chat turn would buy nothing.
 */
export function knownRoles(client: McpToolClient): Promise<Set<string>> {
  const hit = cache.get(client);
  if (hit) return hit;

  const pending = client.listPrompts().then(({ prompts }) => {
    const names = new Set<string>();
    for (const prompt of recommendedPrompts(prompts)) {
      const role = prompt._meta?.["role"];
      if (typeof role === "string" && role.length > 0) names.add(role);
    }
    return names;
  });
  // A rejected lookup must not be cached, or one MCP hiccup would unframe every later
  // turn for the life of the process.
  pending.catch(() => cache.delete(client));
  cache.set(client, pending);
  return pending;
}

/**
 * The framed message for one turn. An unrecognised role is dropped rather than
 * rejected: the answer is still worth streaming, it just isn't framed. A failure
 * reaching MCP degrades the same way, since `/chat`'s own MCP dependency will surface
 * any real outage far more loudly than this would.
 */
export async function frameForRole(
  client: McpToolClient,
  message: string,
  rawRole: unknown
): Promise<string> {
  const role = sanitizeRole(rawRole);
  if (!role) return message;
  try {
    const roles = await knownRoles(client);
    return roles.has(role) ? frameMessage(message, role) : message;
  } catch {
    return message;
  }
}
