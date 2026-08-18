/**
 * Every tunable and shared identifier for this package, in one place.
 *
 * This module imports nothing, matching the other packages' `constants.ts`.
 *
 * The three per-machine settings — what the one port binds, which port, and which
 * hostnames may reach it — also take command-line flags, because a proxy's hostname
 * belongs to the machine you happen to be on and not in a file under version control:
 *
 *     pnpm demo --allowed-host my-proxy.internal
 *
 * A flag beats the matching environment variable, which beats the default.
 */

// --- flags ----------------------------------------------------------------------

export const USAGE = "Usage: pnpm demo [--allowed-host <host>] [--host <addr>] [--port <n>]";

export interface Flags {
  allowedHosts: string[];
  host: string | undefined;
  port: number | undefined;
  /** Everything wrong with the command line, in the order it was found. */
  errors: string[];
}

/** `--allowed-host` and `--allowedHost` are the same flag; nobody should have to guess. */
function canonical(name: string): string {
  return name.toLowerCase().replace(/-/g, "");
}

/** Comma-separated or repeated — the env var already accepts the former, so the flag does too. */
function splitHosts(value: string): string[] {
  return value
    .split(",")
    .map((host) => host.trim())
    .filter((host) => host.length > 0);
}

/**
 * `--flag value` and `--flag=value` both work.
 *
 * Nothing throws: a bad command line is reported through `FLAG_ERRORS` and raised by
 * `main()`, because this module is evaluated during `demo.ts`'s import — before the
 * handler that turns an error into one readable line exists.
 */
export function parseFlags(argv: string[]): Flags {
  const flags: Flags = { allowedHosts: [], host: undefined, port: undefined, errors: [] };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]!;
    // `pnpm demo -- --allowed-host x` forwards the separator itself, so it arrives as an
    // argument like any other. Ignoring it keeps the npm habit from being an error.
    if (token === "--") continue;

    if (!token.startsWith("--")) {
      flags.errors.push(`Unexpected argument "${token}".`);
      continue;
    }

    const equals = token.indexOf("=");
    const name = canonical(equals === -1 ? token.slice(2) : token.slice(2, equals));
    if (name !== "allowedhost" && name !== "host" && name !== "port") {
      flags.errors.push(`Unknown option "${token}".`);
      continue;
    }

    let value: string | undefined;
    if (equals !== -1) {
      value = token.slice(equals + 1);
    } else {
      // A following `--flag` is the next option, not this one's value.
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        value = next;
        i += 1;
      }
    }

    if (value === undefined || value.length === 0) {
      flags.errors.push(`--${name === "allowedhost" ? "allowed-host" : name} needs a value.`);
      continue;
    }

    if (name === "allowedhost") flags.allowedHosts.push(...splitHosts(value));
    else if (name === "host") flags.host = value;
    else {
      const port = Number(value);
      if (!Number.isInteger(port) || port <= 0 || port > 65535) {
        flags.errors.push(`--port needs a port number, got "${value}".`);
      } else {
        flags.port = port;
      }
    }
  }

  return flags;
}

const FLAGS = parseFlags(process.argv.slice(2));

/** Raised by `main()` before anything starts. Empty when the command line is good. */
export const FLAG_ERRORS: readonly string[] = FLAGS.errors;

// --- the one exposed address --------------------------------------------------

/** What the demo server binds. `0.0.0.0` to reach the demo from another host.
 *  `--host`, else `DEMO_HOST`. */
export const DEMO_HOST = FLAGS.host ?? process.env["DEMO_HOST"] ?? "127.0.0.1";
export const DEMO_PORT = FLAGS.port ?? Number(process.env["DEMO_PORT"] ?? 8080);

/**
 * Hostnames allowed to reach the demo. The demo server rejects a `Host` header it
 * doesn't recognise, so reaching the demo by anything other than localhost requires
 * naming that host here. Also widens the MCP server's own DNS-rebinding guards, so
 * `/mcp` stays usable through the same address.
 *
 * `--allowed-host` (repeatable, or comma-separated), else `DEMO_ALLOWED_HOSTS`.
 */
export const DEMO_ALLOWED_HOSTS =
  FLAGS.allowedHosts.length > 0 ? FLAGS.allowedHosts : splitHosts(process.env["DEMO_ALLOWED_HOSTS"] ?? "");

// --- the loopback services behind it -------------------------------------------

/** Both child servers hardcode `127.0.0.1`, so these ports are never externally
 *  reachable — only the demo port above is. */
export const CHILD_HOST = "127.0.0.1";
export const MCP_PORT = Number(process.env["DEMO_MCP_PORT"] ?? 3000);
export const AGENT_PORT = Number(process.env["DEMO_AGENT_PORT"] ?? 3001);

export const MCP_URL = `http://${CHILD_HOST}:${MCP_PORT}/mcp`;
export const MCP_HEALTH_URL = `http://${CHILD_HOST}:${MCP_PORT}/health`;
export const AGENT_HEALTH_URL = `http://${CHILD_HOST}:${AGENT_PORT}/health`;

// --- routing --------------------------------------------------------------------

/**
 * The prefix the browser reaches the agent under, as the demo server's route table
 * keys it — root-absolute, because that is the path an outer proxy hands us once it
 * has stripped its own prefix. The proxy strips this one again before forwarding, so
 * agent-server's route constants stay as they are.
 */
export const AGENT_PREFIX = "/api";

/**
 * The same route, relative rather than root-absolute. This is what gets baked into the
 * client as `VITE_AGENT_URL`, so `AGENT_URL` in web-client's own `constants.ts` resolves
 * against the document: every call is same-origin — no CORS, and no absolute
 * `http://127.0.0.1:3001` unreachable from behind a proxy — and it stays inside a
 * proxy's path prefix instead of escaping to the origin root.
 */
export const AGENT_CLIENT_BASE = AGENT_PREFIX.replace(/^\//, "");

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

/** The build output we serve, inside the web client's package. */
export const DIST_DIR = "dist";

export const INDEX_HTML = "index.html";

/** Everything under here is content-hashed by the build, so it can be cached forever —
 *  and a miss under it is a real 404 rather than a fallback to `index.html`. */
export const ASSETS_PREFIX = "/assets/";

// --- serving --------------------------------------------------------------------

/** Hostnames the demo always answers to, before `--allowed-host` adds any. Mirrors
 *  mcp-server's `LOCALHOST_NAMES`: naming a proxy widens this list, never replaces it. */
export const LOCALHOST_NAMES = ["localhost", "127.0.0.1", "[::1]"];

/**
 * Extension to content type. Deliberately a short explicit table rather than a mime
 * database: `dist/` holds html, js and css, and the rest are here so a favicon or a font
 * added later doesn't arrive as a download.
 */
export const CONTENT_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

/** What an unknown extension is served as. Not `text/plain`: a browser must not try to
 *  interpret something we could not identify. */
export const FALLBACK_CONTENT_TYPE = "application/octet-stream";

/** Hashed asset names change when their content does, so they never need revalidating. */
export const ASSET_CACHE_CONTROL = "public, max-age=31536000, immutable";

/** Everything else — `index.html` above all — must be revalidated, which the ETag then
 *  answers with a 304. */
export const DEFAULT_CACHE_CONTROL = "no-cache";

/**
 * Headers that must not be copied from one hop to the next (RFC 9110 §7.6.1). Node
 * frames the response itself, so passing `transfer-encoding` through would have us
 * declaring a framing we are not performing.
 */
export const HOP_BY_HOP_HEADERS = [
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
];
