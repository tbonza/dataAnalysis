import { AGENT_URL, CHAT_PATH, SSE_DATA_PREFIX, SSE_FRAME_SEPARATOR } from "./constants.js";

/** The event shapes the agent server streams over SSE. Mirrors `Event` in
 *  `agent-server/src/server.ts` — the two are coupled by deployment, not by code. */
export type AgentEvent =
  /** `delta` marks one token chunk of a message still being generated, which the log
   *  appends to the text part in progress. Without it, a `text` event is a whole block. */
  | { type: "text"; text: string; delta?: true }
  | { type: "tool"; name: string; detail?: string }
  | { type: "chart"; chartId: string; chartType?: string; vlSpec: Record<string, unknown> }
  | { type: "report"; markdown: string }
  | { type: "error"; message: string }
  | { type: "done" };

export interface ChatRequest {
  message: string;
  threadId: string;
  /** The role to frame the answer for. Omitted entirely when the user hasn't picked one,
   *  so the agent answers plainly. */
  role?: string;
}

/**
 * POST one turn and hand each SSE event to `onEvent` as it arrives.
 *
 * Deliberately free of React: the transport is the same whether a component, a test or a
 * script drives it, and keeping it here is what lets `useChat` stay a thin state wrapper.
 */
export async function streamChat(
  request: ChatRequest,
  onEvent: (event: AgentEvent) => void
): Promise<void> {
  const response = await fetch(`${AGENT_URL}${CHAT_PATH}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!response.body) throw new Error("The agent server returned no stream.");

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += value;

    // Frames are separated by a blank line; whatever trails the last separator is a
    // partial frame and stays buffered until the rest of it arrives.
    const frames = buffer.split(SSE_FRAME_SEPARATOR);
    buffer = frames.pop() ?? "";

    for (const frame of frames) {
      const line = frame.split("\n").find((candidate) => candidate.startsWith(SSE_DATA_PREFIX));
      if (!line) continue;
      onEvent(JSON.parse(line.slice(SSE_DATA_PREFIX.length)) as AgentEvent);
    }
  }
}
