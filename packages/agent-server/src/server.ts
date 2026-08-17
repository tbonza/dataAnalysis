import { createServer, type ServerResponse } from "node:http";
import { buildAgent, type AgentBundle } from "./agent.js";

const PORT = Number(process.env.AGENT_PORT ?? 3001);
const HOST = "127.0.0.1";
/** The web client runs on a different port, so it needs an explicit origin allowance. */
const ALLOWED_ORIGIN = process.env.CLIENT_ORIGIN ?? "http://127.0.0.1:5173";

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
    const spec = record["vl_spec"] ?? record["vlSpec"];
    if (spec && typeof spec === "object" && Object.keys(spec).length > 0) {
      events.push({
        type: "chart",
        chartId: String(record["chart_id"] ?? record["chartId"] ?? ""),
        ...(typeof record["chart_type"] === "string" ? { chartType: record["chart_type"] } : {}),
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
      recursionLimit: 50,
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

const bundlePromise = buildAgent();

const httpServer = createServer((req, res) => {
  const cors = {
    "access-control-allow-origin": ALLOWED_ORIGIN,
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "POST, GET, OPTIONS",
  };

  if (req.method === "OPTIONS") {
    res.writeHead(204, cors);
    res.end();
    return;
  }

  const path = new URL(req.url ?? "/", `http://${HOST}:${PORT}`).pathname;

  if (path === "/health") {
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

  if (path === "/chat" && req.method === "POST") {
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
          const threadId = typeof body.threadId === "string" && body.threadId ? body.threadId : "default";
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

httpServer.listen(PORT, HOST, () => {
  console.error(`Agent server on http://${HOST}:${PORT}/chat`);
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
