/**
 * Every tunable and shared identifier for this package, in one place.
 *
 * Browser-side only — `vite.config.ts` runs in plain Node and must not import this
 * module, since `import.meta.env` is undefined there.
 */

export const AGENT_URL = import.meta.env["VITE_AGENT_URL"] ?? "http://127.0.0.1:3001";

export const CHAT_PATH = "/chat";
export const PROMPTS_PATH = "/prompts";

/** SSE framing, as the agent server writes it (`data: <json>\n\n`). */
export const SSE_DATA_PREFIX = "data: ";
export const SSE_FRAME_SEPARATOR = "\n\n";

// --- roles ------------------------------------------------------------------------

/** The role a visitor starts as, so the first question is framed rather than plain.
 *  Falls back to whichever role the library lists first if this one isn't in it. */
export const DEFAULT_ROLE_SLUG = "ceo";

// --- copy -----------------------------------------------------------------------

export const APP_TITLE = "Chart agent";
export const APP_TAGLINE = "Ask about your data, get charts back";

export const COMPOSER_PLACEHOLDER = "Ask a question about the data…";
export const SEND_LABEL = "Send";

export const DATA_READY_LABEL = "Data ready:";

/** The composer chip. Its label is state: with no role it offers the destination, with
 *  one it reports the choice. */
export const ROLE_CHIP_EMPTY = "Suggested questions";
export const ROLE_CHIP_LEAD = "Asking as";
export const ROLE_CLEAR_LABEL = "Clear role";

export const DRAWER_TITLE = "Suggested questions";
export const DRAWER_CLOSE_LABEL = "Close";
export const DRAWER_EMPTY = "No suggested prompts — the agent server may not be running.";

export const ROLE_LABEL = "Role";
export const ROLE_SEARCH_PLACEHOLDER = "Type to filter…";
export const ROLE_NO_MATCH = "No matching role";
/** The picker's "no role" option: the agent answers plainly, framing for no one. */
export const ROLE_ANY_LABEL = "Anyone";
export const ROLE_PICK_HINT = "Pick a role to see its suggested questions.";

export const WORKING_LABEL = "Working…";
/** `<summary>` of a collapsed tool trail: "3 steps · query, create_chart". */
export function trailSummary(names: string[]): string {
  const n = names.length;
  return `${n} step${n === 1 ? "" : "s"} · ${names.join(", ")}`;
}
