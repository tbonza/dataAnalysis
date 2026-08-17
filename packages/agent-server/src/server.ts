import { createServer, type ServerResponse } from "node:http";
import { buildAgent, type AgentBundle } from "./agent.js";
import {
  AGENT_PORT,
  CHAT_PATH,
  CLIENT_ORIGIN,
  DATASETS_PATH,
  DEFAULT_THREAD_ID,
  HEALTH_PATH,
  HOST,
  PROMPTS_PATH,
  RECOMMENDED_PROMPT_KIND,
  RECURSION_LIMIT,
} from "./constants.js";

type Event =
  | { type: "text"; text: string }
  | { type: "tool"; name: string; detail?: string }
  | { type: "chart"; chartId: string; chartType?: string; vlSpec: Record<string, unknown> }
  | { type: "report"; markdown: string }
  | { type: "error"; message: string }
  | { type: "done" };

function send(res: ServerResponse, event: Event): void {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

/**
 * Tool results arrive as JSON text on a ToolMessage. Charts are the payloads the client
 * has to render, so they are pulled out and tagged rather than left for it to discover.
 */
function chartEventsFrom(content: unknown): Event[] {
  if (typeof content !== "string") return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return [];
  }
  const events: Event[] = [];
  const visit = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const entry of value) visit(entry);
      return;
    }
    const record = value as Record<string, unknown>;
    const spec = record["vlSpec"];
    if (spec && typeof spec === "object" && Object.keys(spec).length > 0) {
      events.push({
        type: "chart",
        chartId: String(record["chartId"] ?? ""),
        ...(typeof record["chartType"] === "string" ? { chartType: record["chartType"] } : {}),
        vlSpec: spec as Record<string, unknown>,
      });
    }
    if (typeof record["markdown"] === "string" && Array.isArray(record["charts"])) {
      events.push({ type: "report", markdown: record["markdown"] });
    }
    for (const entry of Object.values(record)) visit(entry);
  };
  visit(parsed);
  return events;
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        part && typeof part === "object" && (part as { type?: string }).type === "text"
          ? String((part as { text?: unknown }).text ?? "")
          : ""
      )
      .join("");
  }
  return "";
}

async function streamChat(
  bundle: AgentBundle,
  message: string,
  threadId: string,
  res: ServerResponse
): Promise<void> {
  const seenCharts = new Set<string>();

  const stream = await bundle.agent.stream(
    { messages: [{ role: "user", content: message }], files: bundle.skillFiles },
    {
      streamMode: "updates",
      recursionLimit: RECURSION_LIMIT,
      // The thread is what makes a follow-up turn see the previous one's charts.
      configurable: { thread_id: threadId },
    }
  );

  for await (const update of stream) {
    for (const nodeState of Object.values(update as Record<string, unknown>)) {
      const messages = (nodeState as { messages?: unknown[] })?.messages;
      if (!Array.isArray(messages)) continue;

      for (const raw of messages) {
        const entry = raw as {
          getType?: () => string;
          content?: unknown;
          name?: string;
          tool_calls?: Array<{ name?: string; args?: unknown }>;
        };
        const kind = entry.getType?.();

        if (kind === "ai") {
          for (const call of entry.tool_calls ?? []) {
            if (call.name) send(res, { type: "tool", name: call.name });
          }
          const text = textOf(entry.content).trim();
          if (text) send(res, { type: "text", text });
        } else if (kind === "tool") {
          for (const event of chartEventsFrom(entry.content)) {
            if (event.type === "chart") {
              if (seenCharts.has(event.chartId)) continue;
              seenCharts.add(event.chartId);
            }
            send(res, event);
          }
        }
      }
    }
  }
}

/** Pull the structured payload out of a tool result, falling back to text blocks —
 *  the same fallback mcp-server's own `cli.ts` uses. */
function resultOf(result: { structuredContent?: unknown; content?: unknown[] }): unknown {
  if (result.structuredContent !== undefined) return result.structuredContent;
  return textOf(result.content);
}

interface GroupedPrompts {
  dataset: string;
  roles: Array<{
    role: string;
    roleSlug: string;
    prompts: Array<{ name: string; title: string }>;
  }>;
}

/** `listPrompts()`'s recommended-prompt entries, grouped dataset -> role -> prompt —
 *  the shape the web picker renders directly. */
function groupPrompts(
  prompts: Array<{ name: string; title?: string; description?: string; _meta?: Record<string, unknown> }>
): GroupedPrompts[] {
  const byDataset = new Map<string, Map<string, GroupedPrompts["roles"][number]>>();

  for (const prompt of prompts) {
    const meta = prompt._meta;
    if (!meta || meta["kind"] !== RECOMMENDED_PROMPT_KIND) continue;
    const dataset = meta["dataset"];
    const role = meta["role"];
    const roleSlug = meta["roleSlug"];
    if (typeof dataset !== "string" || typeof role !== "string" || typeof roleSlug !== "string") continue;

    let roles = byDataset.get(dataset);
    if (!roles) {
      roles = new Map();
      byDataset.set(dataset, roles);
    }
    let entry = roles.get(roleSlug);
    if (!entry) {
      entry = { role, roleSlug, prompts: [] };
      roles.set(roleSlug, entry);
    }
    entry.prompts.push({ name: prompt.name, title: prompt.title ?? prompt.name });
  }

  return [...byDataset.entries()].map(([dataset, roles]) => ({
    dataset,
    roles: [...roles.values()],
  }));
}

/** Write one bundle-derived JSON response, or a 503 if the MCP server is unreachable —
 *  the pattern `/health` already used, generalized for `/datasets` and `/prompts`. */
function respondWithBundle(
  res: ServerResponse,
  cors: Record<string, string>,
  fn: (bundle: AgentBundle) => Promise<unknown>
): void {
  void bundlePromise.then(
    async (bundle) => {
      try {
        const body = await fn(bundle);
        res.writeHead(200, { ...cors, "content-type": "application/json" });
        res.end(JSON.stringify(body));
      } catch (err) {
        res.writeHead(502, { ...cors, "content-type": "application/json" });
        res.end(JSON.stringify({ status: "error", error: err instanceof Error ? err.message : String(err) }));
      }
    },
    (err: unknown) => {
      res.writeHead(503, { ...cors, "content-type": "application/json" });
      res.end(JSON.stringify({ status: "error", error: String(err) }));
    }
  );
}

const bundlePromise = buildAgent();

const httpServer = createServer((req, res) => {
  const cors = {
    "access-control-allow-origin": CLIENT_ORIGIN,
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "POST, GET, OPTIONS",
  };

  if (req.method === "OPTIONS") {
    res.writeHead(204, cors);
    res.end();
    return;
  }

  const path = new URL(req.url ?? "/", `http://${HOST}:${AGENT_PORT}`).pathname;

  if (path === HEALTH_PATH) {
    void bundlePromise.then(
      (bundle) => {
        res.writeHead(200, { ...cors, "content-type": "application/json" });
        res.end(JSON.stringify({ status: "ok", skills: bundle.skillNames, tools: bundle.toolNames }));
      },
      (err: unknown) => {
        res.writeHead(503, { ...cors, "content-type": "application/json" });
        res.end(JSON.stringify({ status: "error", error: String(err) }));
      }
    );
    return;
  }

  if (path === DATASETS_PATH && req.method === "GET") {
    respondWithBundle(res, cors, async (bundle) => {
      const raw = await bundle.mcpClient.callTool({ name: "list_available_datasets", arguments: {} });
      return resultOf(raw);
    });
    return;
  }

  if (path === PROMPTS_PATH && req.method === "GET") {
    respondWithBundle(res, cors, async (bundle) => {
      const { prompts } = await bundle.mcpClient.listPrompts();
      return { datasets: groupPrompts(prompts) };
    });
    return;
  }

  if (path === CHAT_PATH && req.method === "POST") {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      void (async () => {
        res.writeHead(200, {
          ...cors,
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        });
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
            message?: unknown;
            threadId?: unknown;
          };
          const message = typeof body.message === "string" ? body.message.trim() : "";
          if (!message) throw new Error("Request body needs a non-empty `message`.");
          const threadId = typeof body.threadId === "string" && body.threadId ? body.threadId : DEFAULT_THREAD_ID;
          await streamChat(await bundlePromise, message, threadId, res);
        } catch (err) {
          send(res, { type: "error", message: err instanceof Error ? err.message : String(err) });
        } finally {
          send(res, { type: "done" });
          res.end();
        }
      })();
    });
    return;
  }

  res.writeHead(404, { ...cors, "content-type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
});

httpServer.listen(AGENT_PORT, HOST, () => {
  console.error(`Agent server on http://${HOST}:${AGENT_PORT}${CHAT_PATH}`);
  void bundlePromise.then(
    (bundle) => {
      console.error(`Tools from MCP: ${bundle.toolNames.join(", ")}`);
      console.error(`Skills from MCP: ${bundle.skillNames.join(", ")}`);
    },
    (err: unknown) => console.error("Failed to reach the MCP server:", err)
  );
});

process.on("SIGINT", () => {
  void (async () => {
    const bundle = await bundlePromise.catch(() => undefined);
    await bundle?.close();
    httpServer.close();
    process.exit(0);
  })();
});
