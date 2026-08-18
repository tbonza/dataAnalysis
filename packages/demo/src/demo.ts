/**
 * `pnpm demo` — the whole demo behind one address.
 *
 * The three services normally run on three ports and the browser talks cross-origin to
 * the agent on :3001. That falls apart behind a network proxy, where only one address
 * is reachable. This script keeps the MCP and agent servers on loopback, builds the web
 * client so its API calls are same-origin and relative, and puts our own server
 * (`server.ts`) in front of all three as the single exposed port.
 *
 * Nothing about the three-shell development workflow changes: `pnpm mcp`, `pnpm agent`
 * and `pnpm web` still do exactly what they did.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";

import {
  AGENT_CLIENT_BASE,
  AGENT_HEALTH_URL,
  AGENT_PORT,
  AGENT_PREFIX,
  AGENT_READY_TIMEOUT_MS,
  CHILD_HOST,
  DEMO_ALLOWED_HOSTS,
  DEMO_HOST,
  DEMO_PORT,
  DIST_DIR,
  FLAG_ERRORS,
  MCP_HEALTH_URL,
  MCP_PORT,
  MCP_PREFIX,
  MCP_READY_TIMEOUT_MS,
  MCP_URL,
  READY_POLL_INTERVAL_MS,
  SHUTDOWN_GRACE_MS,
  SKIP_BUILD,
  USAGE,
  WEB_CLIENT_DIR,
} from "./constants.js";
import { startDemoServer } from "./server.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../..");
const WEB_CLIENT_ROOT = resolve(HERE, "..", WEB_CLIENT_DIR);

// --- child processes ------------------------------------------------------------

/** Every child we started, so a signal — or a crash — takes all of them down. */
const children = new Set<ChildProcess>();
let shuttingDown = false;

/**
 * Children are spawned into their own process group (`detached`) so that killing the
 * group reaches the `tsx` process pnpm spawns underneath, not just pnpm itself.
 * Killing only the parent is what leaves stray listeners on :3000 and :3001.
 */
function spawnService(name: string, filter: string, env: Record<string, string>): ChildProcess {
  const child = spawn("pnpm", ["--filter", filter, "start"], {
    cwd: REPO_ROOT,
    detached: true,
    stdio: ["ignore", "inherit", "inherit"],
    env: {
      ...process.env,
      ...env,
      // Node's global fetch ignores HTTP_PROXY by default, so the agent's loopback call
      // to the MCP server is already safe. This is belt-and-braces for an environment
      // that installs a proxy-aware dispatcher: loopback must never leave the machine.
      NO_PROXY: [process.env["NO_PROXY"], CHILD_HOST, "localhost"].filter(Boolean).join(","),
      no_proxy: [process.env["no_proxy"], CHILD_HOST, "localhost"].filter(Boolean).join(","),
    },
  });

  children.add(child);
  child.on("exit", (code, signal) => {
    children.delete(child);
    if (shuttingDown) return;
    console.error(`\n${name} exited unexpectedly (${signal ?? code}). Shutting the demo down.`);
    void shutdown(1);
  });
  return child;
}

/** SIGTERM the whole process group, SIGKILL anything still alive after the grace period. */
function stopChild(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    // Already gone, or the group no longer exists. Either way there is nothing to stop.
  }
}

async function shutdown(code: number): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) stopChild(child, "SIGTERM");
  if (children.size > 0) {
    await new Promise((r) => setTimeout(r, SHUTDOWN_GRACE_MS));
    for (const child of children) stopChild(child, "SIGKILL");
  }
  process.exit(code);
}

// --- readiness ------------------------------------------------------------------

/** True if something is already listening — a stray `pnpm mcp`/`pnpm agent`, usually. */
async function portInUse(port: number): Promise<boolean> {
  return new Promise((resolveInUse) => {
    const probe = createServer();
    probe.once("error", () => resolveInUse(true));
    probe.once("listening", () => probe.close(() => resolveInUse(false)));
    probe.listen(port, CHILD_HOST);
  });
}

/**
 * Poll a child's `/health` until it answers. The order matters: agent-server builds its
 * agent at startup by fetching tools and skills over MCP, and a failure there is
 * permanent — every route serves 503 for the life of the process. So the agent is not
 * started until the MCP server is actually answering.
 */
async function waitForHealth(name: string, url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError = "no response";
  while (Date.now() < deadline) {
    if (shuttingDown) return;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(READY_POLL_INTERVAL_MS * 4) });
      if (res.ok) return;
      lastError = `HTTP ${res.status}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    await new Promise((r) => setTimeout(r, READY_POLL_INTERVAL_MS));
  }
  throw new Error(`${name} was not ready within ${timeoutMs / 1000}s (last: ${lastError}).`);
}

// --- main -----------------------------------------------------------------------

async function main(): Promise<void> {
  // Checked before anything is started: a mistyped flag must not look like it worked.
  if (FLAG_ERRORS.length > 0) {
    throw new Error([...FLAG_ERRORS, USAGE].join("\n"));
  }

  for (const [label, port] of [
    ["MCP server", MCP_PORT],
    ["agent server", AGENT_PORT],
  ] as const) {
    if (await portInUse(port)) {
      throw new Error(
        `Port ${port} is already in use, so the demo's ${label} cannot start. ` +
          `Stop the stray process (\`lsof -tiTCP:${port} -sTCP:LISTEN | xargs kill\`), ` +
          `or point the demo elsewhere with DEMO_MCP_PORT / DEMO_AGENT_PORT.`
      );
    }
  }

  if (SKIP_BUILD) {
    console.error("Skipping the web client build (DEMO_SKIP_BUILD is set).");
  } else {
    // Baked into the bundle: the client's API base becomes a document-relative prefix,
    // so every call is same-origin (CORS never enters into it) and stays inside a
    // proxy's path prefix rather than escaping to the origin root. Vite picks
    // `VITE_`-prefixed keys up from `process.env`, so this needs no `.env` file.
    process.env["VITE_AGENT_URL"] = AGENT_CLIENT_BASE;
    console.error("Building the web client…");
    // `base: "./"` for the same reason: the emitted `index.html` asks for
    // `./assets/…` rather than `/assets/…`, so a proxy serving the demo under a path
    // prefix (`/proxy/8080/`) doesn't send the browser to the origin root for the JS
    // and CSS. Set here rather than in web-client/vite.config.ts so `pnpm web` — where
    // there is no prefix and no build — is untouched. The demo server serves `dist/` at
    // `/`, which is what the proxy requests once it has stripped its own prefix.
    await build({ root: WEB_CLIENT_ROOT, base: "./", logLevel: "warn" });
  }

  console.error(`Starting the MCP server on ${CHILD_HOST}:${MCP_PORT}…`);
  spawnService("The MCP server", "mcp-server", {
    PORT: String(MCP_PORT),
    // Default is localhost-only. Naming the demo's own hostname here keeps `/mcp`
    // usable when the demo is reached as something other than localhost.
    ...(DEMO_ALLOWED_HOSTS.length > 0
      ? { MCP_ALLOWED_HOSTS: DEMO_ALLOWED_HOSTS.join(","), MCP_ALLOWED_ORIGINS: DEMO_ALLOWED_HOSTS.join(",") }
      : {}),
  });
  await waitForHealth("The MCP server", MCP_HEALTH_URL, MCP_READY_TIMEOUT_MS);

  console.error(`Starting the agent server on ${CHILD_HOST}:${AGENT_PORT}…`);
  spawnService("The agent server", "agent-server", {
    AGENT_PORT: String(AGENT_PORT),
    MCP_URL,
  });
  await waitForHealth("The agent server", AGENT_HEALTH_URL, AGENT_READY_TIMEOUT_MS);
  if (shuttingDown) return;

  await startDemoServer({
    host: DEMO_HOST,
    port: DEMO_PORT,
    allowedHosts: DEMO_ALLOWED_HOSTS,
    distDir: resolve(WEB_CLIENT_ROOT, DIST_DIR),
    routes: [
      // Stripped on the way through, so agent-server keeps serving `/chat`, `/prompts`
      // and `/datasets` at the paths its own constants declare.
      {
        prefix: AGENT_PREFIX,
        strip: true,
        host: CHILD_HOST,
        port: AGENT_PORT,
        hostHeader: `${CHILD_HOST}:${AGENT_PORT}`,
      },
      // Path intact — the MCP server owns `/mcp` on both sides. The rewritten `Host` is
      // what satisfies its DNS-rebinding guard without weakening it.
      {
        prefix: MCP_PREFIX,
        strip: false,
        host: CHILD_HOST,
        port: MCP_PORT,
        hostHeader: `${CHILD_HOST}:${MCP_PORT}`,
      },
    ],
  });

  const shown = DEMO_HOST === "0.0.0.0" || DEMO_HOST === "::" ? (DEMO_ALLOWED_HOSTS[0] ?? "localhost") : DEMO_HOST;
  const base = `http://${shown}:${DEMO_PORT}`;
  console.error("");
  console.error(`  Demo ready — everything is behind ${base}`);
  console.error(`    chat client   ${base}/`);
  console.error(`    agent API     ${base}${AGENT_PREFIX}/health`);
  console.error(`    MCP endpoint  ${base}${MCP_PREFIX}`);
  console.error("");
}

// The demo server installs no signal handlers of its own, so these are the only ones:
// a signal has to reach the children, or `pnpm demo` leaves listeners on :3000 and :3001.
process.on("SIGINT", () => void shutdown(0));
process.on("SIGTERM", () => void shutdown(0));
// Last resort: `kill` is safe to call synchronously, so an exit by any other route
// still takes the children with it.
process.on("exit", () => {
  for (const child of children) stopChild(child, "SIGKILL");
});

main().catch((err: unknown) => {
  console.error(`\n${err instanceof Error ? err.message : String(err)}`);
  void shutdown(1);
});
