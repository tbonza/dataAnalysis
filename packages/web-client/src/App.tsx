import { useCallback, useEffect, useRef, useState } from "react";
import { Chart } from "./Chart.js";
import {
  AGENT_URL,
  APP_TAGLINE,
  APP_TITLE,
  CHAT_PATH,
  COMPOSER_PLACEHOLDER,
  DATA_READY_LABEL,
  DRAWER_BUTTON_LABEL,
  EMPTY_LOG_LEAD,
  EMPTY_LOG_LINK,
  WORKING_LABEL,
  trailSummary,
} from "./constants.js";
import { fetchLibrary, type DatasetGroup } from "./library.js";
import { RolesDrawer } from "./RolesDrawer.js";

/** The event shapes the agent server streams over SSE. */
type AgentEvent =
  | { type: "text"; text: string }
  | { type: "tool"; name: string; detail?: string }
  | { type: "chart"; chartId: string; chartType?: string; vlSpec: Record<string, unknown> }
  | { type: "report"; markdown: string }
  | { type: "error"; message: string }
  | { type: "done" };

interface Step {
  name: string;
  detail?: string;
}

type Part =
  | { kind: "text"; text: string }
  | { kind: "tool"; step: Step }
  | { kind: "chart"; chartId: string; spec: Record<string, unknown> }
  | { kind: "error"; message: string };

interface Turn {
  role: "user" | "assistant";
  /** Rendered in order, so a chart appears where the agent produced it. */
  parts: Part[];
}

/** Rendered form of a turn: consecutive tool calls fold into one collapsed trail, so
 *  the ReAct loop is visible on demand without interleaving every step with the
 *  answer. Text and charts stay exactly where they were. */
type Rendered = Exclude<Part, { kind: "tool" }> | { kind: "trail"; steps: Step[] };

function groupParts(parts: Part[]): Rendered[] {
  const out: Rendered[] = [];
  for (const part of parts) {
    if (part.kind !== "tool") {
      out.push(part);
      continue;
    }
    const last = out[out.length - 1];
    if (last && last.kind === "trail") last.steps.push(part.step);
    else out.push({ kind: "trail", steps: [part.step] });
  }
  return out;
}

/** The most recent tool the agent called this turn — shown next to "Working…". */
function lastStepOf(turns: Turn[]): Step | undefined {
  const last = turns[turns.length - 1];
  if (!last || last.role !== "assistant") return undefined;
  for (let i = last.parts.length - 1; i >= 0; i--) {
    const part = last.parts[i];
    if (part && part.kind === "tool") return part.step;
  }
  return undefined;
}

export function App(): React.ReactElement {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [library, setLibrary] = useState<DatasetGroup[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  // One thread for the page's lifetime, so a follow-up like "make the bars green" can
  // see the chart the previous turn made.
  const threadId = useRef(crypto.randomUUID());

  // The library is fetched once and shared by the empty state and the drawer.
  useEffect(() => {
    let cancelled = false;
    void fetchLibrary().then((datasets) => {
      if (!cancelled) setLibrary(datasets);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const openDrawer = useCallback(() => setDrawerOpen(true), []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  // Picking never sends — it fills the composer, editable, and hands focus to the
  // textarea so the user can send as-is or adjust it first. The drawer has already
  // closed itself (and restored focus to its opener) by the time this runs, so the
  // synchronous focus call here is the one that sticks.
  const pickPrompt = useCallback((text: string) => {
    setDraft(text);
    setDrawerOpen(false);
    textarea.current?.focus();
  }, []);

  const appendPart = useCallback((part: Part) => {
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
          else if (event.type === "tool")
            appendPart({
              kind: "tool",
              step: event.detail ? { name: event.name, detail: event.detail } : { name: event.name },
            });
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

  const lastStep = busy ? lastStepOf(turns) : undefined;

  return (
    <div className="app">
      <header>
        <button type="button" className="ghost" onClick={openDrawer} aria-haspopup="dialog">
          {DRAWER_BUTTON_LABEL}
        </button>
        <strong>{APP_TITLE}</strong>
        <span>{APP_TAGLINE}</span>
      </header>

      <div className="log" ref={scroller}>
        {turns.length === 0 && (
          <div className="empty">
            {library.map((group) => (
              <p key={group.dataset} className="data-ready">
                <span className="label">{DATA_READY_LABEL}</span> <code>{group.dataset}</code>
                {group.description && <> — {group.description}</>}
              </p>
            ))}
            <p className="hint">
              {EMPTY_LOG_LEAD}
              <button type="button" className="link" onClick={openDrawer}>
                {EMPTY_LOG_LINK}
              </button>
              .
            </p>
          </div>
        )}

        {turns.map((turn, turnIndex) => (
          <article key={turnIndex} className={turn.role}>
            {groupParts(turn.parts).map((part, partIndex) => {
              if (part.kind === "text") return <p key={partIndex}>{part.text}</p>;
              if (part.kind === "error")
                return (
                  <p key={partIndex} className="error">
                    {part.message}
                  </p>
                );
              if (part.kind === "trail")
                return (
                  <details key={partIndex} className="trail">
                    <summary>{trailSummary(part.steps.map((s) => s.name))}</summary>
                    <ol>
                      {part.steps.map((step, stepIndex) => (
                        <li key={stepIndex}>
                          <span className="step-name">{step.name}</span>
                          {step.detail && <span className="step-detail">{step.detail}</span>}
                        </li>
                      ))}
                    </ol>
                  </details>
                );
              return <Chart key={`${part.chartId}-${partIndex}`} spec={part.spec} />;
            })}
          </article>
        ))}

        {busy && (
          <p className="hint working">
            {WORKING_LABEL}
            {lastStep && <span className="step-name">{lastStep.name}</span>}
          </p>
        )}
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

      <RolesDrawer
        open={drawerOpen}
        datasets={library}
        busy={busy}
        onPick={pickPrompt}
        onClose={closeDrawer}
      />
    </div>
  );
}
