/**
 * Every tunable and shared identifier for this package, in one place.
 *
 * This module imports nothing, matching the other packages' `constants.ts`.
 */

// --- the one exposed address --------------------------------------------------

/** What the preview server binds. `0.0.0.0` to reach the demo from another host. */
export const DEMO_HOST = process.env["DEMO_HOST"] ?? "127.0.0.1";
export const DEMO_PORT = Number(process.env["DEMO_PORT"] ?? 8080);

/**
 * Hostnames allowed to reach the demo, comma-separated. Vite's preview server rejects
 * a `Host` header it doesn't recognise, so reaching the demo by anything other than
 * localhost requires naming that host here. Also widens the MCP server's own
 * DNS-rebinding guards, so `/mcp` stays usable through the same address.
 */
export const DEMO_ALLOWED_HOSTS = (process.env["DEMO_ALLOWED_HOSTS"] ?? "")
  .split(",")
  .map((host) => host.trim())
  .filter((host) => host.length > 0);

// --- the loopback services behind it -------------------------------------------

/** Both child servers hardcode `127.0.0.1`, so these ports are never externally
 *  reachable — only the preview port above is. */
export const CHILD_HOST = "127.0.0.1";
export const MCP_PORT = Number(process.env["DEMO_MCP_PORT"] ?? 3000);
export const AGENT_PORT = Number(process.env["DEMO_AGENT_PORT"] ?? 3001);

export const MCP_URL = `http://${CHILD_HOST}:${MCP_PORT}/mcp`;
export const MCP_HEALTH_URL = `http://${CHILD_HOST}:${MCP_PORT}/health`;
export const AGENT_HEALTH_URL = `http://${CHILD_HOST}:${AGENT_PORT}/health`;

// --- routing --------------------------------------------------------------------

/**
 * The prefix the browser reaches the agent under. Baked into the client at build time
 * as `VITE_AGENT_URL`, so `AGENT_URL` in web-client's own `constants.ts` becomes a
 * relative base and every call is same-origin — which is the whole point: no CORS, and
 * no absolute `http://127.0.0.1:3001` that is unreachable from behind a proxy.
 *
 * The proxy strips it again before forwarding, so agent-server's route constants stay
 * as they are.
 */
export const AGENT_PREFIX = "/api";

/** Proxied straight through, path intact — the MCP server owns `/mcp` on both sides. */
export const MCP_PREFIX = "/mcp";

// --- startup --------------------------------------------------------------------

/** How long to wait for a child's `/health` before giving up. The agent's first
 *  request builds the whole deep agent (fetching tools and skills over MCP), so its
 *  budget is the generous one. */
export const MCP_READY_TIMEOUT_MS = 30_000;
export const AGENT_READY_TIMEOUT_MS = 60_000;
export const READY_POLL_INTERVAL_MS = 250;

/** Grace period for a child to exit on SIGTERM before it is killed outright. */
export const SHUTDOWN_GRACE_MS = 3_000;

// --- build ----------------------------------------------------------------------

/** Set to skip `vite build` and serve whatever is already in `dist/`. */
export const SKIP_BUILD = Boolean(process.env["DEMO_SKIP_BUILD"]);

/** Where the web client's package lives, relative to this package's directory. */
export const WEB_CLIENT_DIR = "../web-client";
