import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { isBaseMessage, type AIMessage, type ToolMessage } from "@langchain/core/messages";
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
  MODEL_NODE_NAME,
  RECURSION_LIMIT,
  SSE_HEADERS,
  SSE_HEARTBEAT_MS,
  SSE_PADDING_BYTES,
  TOOL_DETAIL_MAX_CHARS,
} from "./constants.js";
import { groupPrompts, resultOf } from "./library.js";
import { frameForRole } from "./roles.js";

type Event =
  /** `delta` marks one token chunk of a message still being generated, which the client
   *  appends to the text part in progress. Without it, a `text` event is a whole block. */
  | { type: "text"; text: string; delta?: true }
  | { type: "tool"; name: string; detail?: string }
  | { type: "chart"; chartId: string; chartType?: string; vlSpec: Record<string, unknown> }
  | { type: "report"; markdown: string }
  | { type: "error"; message: string }
  | { type: "done" };

function send(res: ServerResponse, event: Event): void {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

/** An SSE comment. Carries no `data:` line, so the client skips it — which is what makes
 *  it usable as padding and as a heartbeat. */
function comment(res: ServerResponse, text: string): void {
  res.write(`: ${text}\n\n`);
}

/**
 * Open the SSE response and start it flowing.
 *
 * Three things have to happen before the first event, and none of them are the default:
 * the headers have to reach the client (`writeHead` only stores them — Node sends them
 * with the first body chunk, so without `flushHeaders` the browser's `fetch` cannot even
 * resolve until the first model step finishes), Nagle has to be off so single small
 * frames aren't held for coalescing, and enough bytes have to be on the wire to push a
 * buffering proxy past its threshold.
 *
 * Returns a stop function for the heartbeat, which the caller must call when the turn
 * ends.
 */
function openStream(req: IncomingMessage, res: ServerResponse, cors: Record<string, string>): () => void {
  res.writeHead(200, { ...cors, ...SSE_HEADERS });
  res.flushHeaders();
  req.socket.setNoDelay(true);

  comment(res, "-".repeat(SSE_PADDING_BYTES));

  const heartbeat = setInterval(() => comment(res, "ping"), SSE_HEARTBEAT_MS);
  // Nothing else keeps the process waiting on this timer.
  heartbeat.unref();

  const stop = (): void => clearInterval(heartbeat);
  // A closed tab must not leave a heartbeat writing into a dead socket.
  req.on("close", stop);
  return stop;
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

/**
 * `AIMessage.content`'s static type is a role-conditional generic
 * (`$InferMessageContent`) that doesn't resolve cleanly off this codebase's
 * unparameterized `AIMessage`/`ToolMessage` — real content at runtime is always
 * `string | Array<ContentBlock>`, so this stays defensive rather than trusting the
 * static type fully.
 */
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

/**
 * One token chunk from the `messages` channel, as `[message, metadata]`.
 *
 * Records the message id in `streamed` so the `updates` channel, which later delivers
 * the same message whole, knows not to send it a second time.
 */
function sendTextDelta(res: ServerResponse, payload: unknown, streamed: Set<string>): void {
  if (!Array.isArray(payload)) return;
  const [raw, metadata] = payload as [unknown, { langgraph_node?: unknown } | undefined];
  if (!isBaseMessage(raw) || raw.getType() !== "ai") return;
  if (metadata?.langgraph_node !== MODEL_NODE_NAME) return;

  // Not trimmed: the whitespace between tokens is part of the answer.
  const text = textOf(raw.content);
  if (!text) return;
  if (raw.id) streamed.add(raw.id);
  send(res, { type: "text", text, delta: true });
}

/** One completed graph node from the `updates` channel: its tool calls, its charts, and
 *  any prose that did not already go out as deltas. */
function sendUpdate(res: ServerResponse, payload: unknown, seenCharts: Set<string>, streamed: Set<string>): void {
  for (const nodeState of Object.values(payload as Record<string, unknown>)) {
    const messages = (nodeState as { messages?: unknown[] })?.messages;
    if (!Array.isArray(messages)) continue;

    for (const raw of messages) {
      if (!isBaseMessage(raw)) continue;
      const kind = raw.getType();

      if (kind === "ai") {
        const ai = raw as AIMessage;
        for (const call of ai.tool_calls ?? []) {
          if (!call.name) continue;
          const detail = detailOf(call.args);
          send(res, detail ? { type: "tool", name: call.name, detail } : { type: "tool", name: call.name });
        }
        // Already streamed token by token, so sending it whole would double it. When
        // nothing streamed — a middleware node, or a langchain change that moves the
        // model node — this is the path that still delivers the answer.
        if (ai.id && streamed.has(ai.id)) continue;
        const text = textOf(ai.content).trim();
        if (text) send(res, { type: "text", text });
      } else if (kind === "tool") {
        const tool = raw as ToolMessage;
        for (const event of chartEventsFrom(tool.content)) {
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

async function streamChat(
  bundle: AgentBundle,
  message: string,
  threadId: string,
  res: ServerResponse
): Promise<void> {
  const seenCharts = new Set<string>();
  const streamed = new Set<string>();

  const stream = await bundle.agent.stream(
    { messages: [{ role: "user", content: message }], files: bundle.skillFiles },
    {
      // `updates` carries tool calls and charts a node at a time; `messages` carries the
      // model's tokens as it writes them. Asking for both is also what makes the model
      // stream at all: langgraph's messages handler declares `lc_prefer_streaming`, which
      // is what sends langchain down its `_streamResponseChunks` path and Bedrock to the
      // Converse *stream* API. Two modes means the stream yields `[mode, payload]` pairs
      // rather than bare payloads.
      streamMode: ["updates", "messages"],
      recursionLimit: RECURSION_LIMIT,
      // The thread is what makes a follow-up turn see the previous one's charts.
      configurable: { thread_id: threadId },
    }
  );

  for await (const chunk of stream as AsyncIterable<[string, unknown]>) {
    const [mode, payload] = chunk;
    if (mode === "messages") sendTextDelta(res, payload, streamed);
    else if (mode === "updates") sendUpdate(res, payload, seenCharts, streamed);
  }
}

/** A tool call's arguments as one compact JSON line for the client's collapsed trail.
 *  Capped so a `load_data` call carrying hundreds of rows doesn't flood the stream —
 *  the trail is for seeing *what* the agent did, not for replaying it. */
function detailOf(args: unknown): string | undefined {
  if (args === undefined || args === null) return undefined;
  const json = JSON.stringify(args);
  if (!json || json === "{}") return undefined;
  return json.length > TOOL_DETAIL_MAX_CHARS ? `${json.slice(0, TOOL_DETAIL_MAX_CHARS)}…` : json;
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
    respondWithBundle(res, cors, async (bundle) => ({
      datasets: await groupPrompts(bundle.mcpClient),
    }));
    return;
  }

  if (path === CHAT_PATH && req.method === "POST") {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      void (async () => {
        const stopHeartbeat = openStream(req, res, cors);
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
            message?: unknown;
            threadId?: unknown;
            role?: unknown;
          };
          const message = typeof body.message === "string" ? body.message.trim() : "";
          if (!message) throw new Error("Request body needs a non-empty `message`.");
          const threadId = typeof body.threadId === "string" && body.threadId ? body.threadId : DEFAULT_THREAD_ID;
          const bundle = await bundlePromise;
          // Sent on every turn rather than only when it changes, so the server stays
          // stateless; an unusable `role` is dropped and the question goes through plain.
          const framed = await frameForRole(bundle.mcpClient, message, body.role);
          await streamChat(bundle, framed, threadId, res);
        } catch (err) {
          send(res, { type: "error", message: err instanceof Error ? err.message : String(err) });
        } finally {
          stopHeartbeat();
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
