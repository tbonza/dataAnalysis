/**
 * Every tunable and shared identifier for this package, in one place.
 *
 * Browser-side only — `vite.config.ts` runs in plain Node and must not import this
 * module, since `import.meta.env` is undefined there.
 */

export const AGENT_URL = import.meta.env["VITE_AGENT_URL"] ?? "http://127.0.0.1:3001";

export const CHAT_PATH = "/chat";
export const PROMPTS_PATH = "/prompts";

// --- copy -----------------------------------------------------------------------

export const APP_TITLE = "Chart agent";
export const APP_TAGLINE = "charts rendered from the specs the tool returns";

export const COMPOSER_PLACEHOLDER = "Ask a question about the data…";

/** Empty chat, library loaded: "Data ready: <name> — <description>." precedes this line. */
export const EMPTY_LOG_LEAD = "Ask a question, or ";
/** The clickable tail of the empty-state line; opens the drawer. */
export const EMPTY_LOG_LINK = "start from a role's suggested question";
export const DATA_READY_LABEL = "Data ready:";

export const DRAWER_BUTTON_LABEL = "Roles & prompts";
export const DRAWER_TITLE = "Start from a role";
export const DRAWER_CLOSE_LABEL = "Close";
export const DRAWER_EMPTY = "No suggested prompts — the agent server may not be running.";

export const WORKING_LABEL = "Working…";
/** `<summary>` of a collapsed tool trail: "3 steps · query, create_chart". */
export function trailSummary(names: string[]): string {
  const n = names.length;
  return `${n} step${n === 1 ? "" : "s"} · ${names.join(", ")}`;
}
