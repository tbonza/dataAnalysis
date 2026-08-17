import { useCallback, useRef, useState } from "react";
import { Chart } from "./Chart.js";
import { AGENT_URL, CHAT_PATH, COMPOSER_PLACEHOLDER, EMPTY_LOG_HINT } from "./constants.js";
import { PromptPicker } from "./PromptPicker.js";

/** The event shapes the agent server streams over SSE. */
type AgentEvent =
  | { type: "text"; text: string }
  | { type: "tool"; name: string; detail?: string }
  | { type: "chart"; chartId: string; chartType?: string; vlSpec: Record<string, unknown> }
  | { type: "report"; markdown: string }
  | { type: "error"; message: string }
  | { type: "done" };

interface Turn {
  role: "user" | "assistant";
  /** Rendered in order, so a chart appears where the agent produced it. */
  parts: Array<
    | { kind: "text"; text: string }
    | { kind: "tool"; name: string }
    | { kind: "chart"; chartId: string; spec: Record<string, unknown> }
    | { kind: "error"; message: string }
  >;
}

export function App(): React.ReactElement {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  // One thread for the page's lifetime, so a follow-up like "make the bars green" can
  // see the chart the previous turn made.
  const threadId = useRef(crypto.randomUUID());

  // The picker never sends — it only fills the composer, editable, and hands focus
  // back so the user can send as-is or adjust it first.
  const pickPrompt = useCallback((text: string) => {
    setDraft(text);
    textarea.current?.focus();
  }, []);

  const appendPart = useCallback((part: Turn["parts"][number]) => {
    setTurns((current) => {
      const next = [...current];
      const last = next[next.length - 1];
      if (!last || last.role !== "assistant") {
        next.push({ role: "assistant", parts: [part] });
        return next;
      }
      next[next.length - 1] = { ...last, parts: [...last.parts, part] };
      return next;
    });
    requestAnimationFrame(() => {
      scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
    });
  }, []);

  const send = useCallback(async () => {
    const message = draft.trim();
    if (!message || busy) return;

    setDraft("");
    setBusy(true);
    setTurns((current) => [...current, { role: "user", parts: [{ kind: "text", text: message }] }]);

    try {
      const response = await fetch(`${AGENT_URL}${CHAT_PATH}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message, threadId: threadId.current }),
      });
      if (!response.body) throw new Error("The agent server returned no stream.");

      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += value;

        // SSE frames are separated by a blank line; keep any partial frame buffered.
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";

        for (const frame of frames) {
          const line = frame.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;
          const event = JSON.parse(line.slice(6)) as AgentEvent;

          if (event.type === "text") appendPart({ kind: "text", text: event.text });
          else if (event.type === "tool") appendPart({ kind: "tool", name: event.name });
          else if (event.type === "chart")
            appendPart({ kind: "chart", chartId: event.chartId, spec: event.vlSpec });
          else if (event.type === "report") appendPart({ kind: "text", text: event.markdown });
          else if (event.type === "error") appendPart({ kind: "error", message: event.message });
        }
      }
    } catch (err) {
      appendPart({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }, [appendPart, busy, draft]);

  return (
    <div className="app">
      <header>
        <strong>Chart agent</strong>
        <span>charts rendered from the specs the tool returns</span>
      </header>

      <div className="log" ref={scroller}>
        {turns.length === 0 && (
          <>
            <p className="hint">{EMPTY_LOG_HINT}</p>
            <PromptPicker onPick={pickPrompt} busy={busy} />
          </>
        )}
        {turns.map((turn, turnIndex) => (
          <article key={turnIndex} className={turn.role}>
            {turn.parts.map((part, partIndex) => {
              if (part.kind === "text") return <p key={partIndex}>{part.text}</p>;
              if (part.kind === "tool")
                return (
                  <p key={partIndex} className="tool">
                    {part.name}
                  </p>
                );
              if (part.kind === "error")
                return (
                  <p key={partIndex} className="error">
                    {part.message}
                  </p>
                );
              return <Chart key={`${part.chartId}-${partIndex}`} spec={part.spec} />;
            })}
          </article>
        ))}
        {busy && <p className="hint">Working…</p>}
      </div>

      <form
        className="composer"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <textarea
          ref={textarea}
          value={draft}
          rows={3}
          placeholder={COMPOSER_PLACEHOLDER}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void send();
            }
          }}
        />
        <button type="submit" disabled={busy || draft.trim().length === 0}>
          Send
        </button>
      </form>
    </div>
  );
}
