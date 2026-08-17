/**
 * Every tunable and shared identifier for this package, in one place.
 *
 * Browser-side only — `vite.config.ts` runs in plain Node and must not import this
 * module, since `import.meta.env` is undefined there.
 */

export const AGENT_URL = import.meta.env["VITE_AGENT_URL"] ?? "http://127.0.0.1:3001";

export const CHAT_PATH = "/chat";
export const PROMPTS_PATH = "/prompts";

export const EMPTY_LOG_HINT = "Pick a recommended prompt, or ask a question below.";
export const COMPOSER_PLACEHOLDER = "Ask a question about the loaded data…";
