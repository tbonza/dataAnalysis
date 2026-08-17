import { useCallback, useRef, useState } from "react";
import { Chart } from "./Chart.js";

const AGENT_URL = import.meta.env["VITE_AGENT_URL"] ?? "http://127.0.0.1:3001";

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

const EXAMPLE =
  "Here is sales data: East/Widget 120 revenue 10 units, East/Gadget 80 revenue 5 units, " +
  "West/Widget 200 revenue 25 units, West/Gadget 50 revenue 2 units, North/Widget 90 revenue 9 units. " +
  "Chart total revenue by region.";

export function App(): React.ReactElement {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState(EXAMPLE);
  const [busy, setBusy] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);

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
      const response = await fetch(`${AGENT_URL}/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message }),
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
        {turns.length === 0 && <p className="hint">Describe some data and ask for a chart.</p>}
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
          value={draft}
          rows={3}
          placeholder="Describe your data and what you want to see…"
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
