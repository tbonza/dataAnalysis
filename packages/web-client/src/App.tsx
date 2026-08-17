import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Chart } from "./Chart.js";
import {
  AGENT_URL,
  APP_TAGLINE,
  APP_TITLE,
  CHAT_PATH,
  COMPOSER_PLACEHOLDER,
  DATA_READY_LABEL,
  ROLE_CHIP_EMPTY,
  ROLE_CHIP_LEAD,
  ROLE_CLEAR_LABEL,
  ROLE_HEADING,
  WORKING_LABEL,
  trailSummary,
} from "./constants.js";
import { fetchLibrary, rolesAcross, type DatasetGroup } from "./library.js";
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
  // The role the next message is asked as, by slug; "" means none, which is the default —
  // `job-roles` only applies a persona when the user names one.
  const [roleSlug, setRoleSlug] = useState("");
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

  const roles = useMemo(() => rolesAcross(library), [library]);
  const role = roles.find((view) => view.roleSlug === roleSlug);

  const openDrawer = useCallback(() => setDrawerOpen(true), []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  // Picking never sends — it fills the composer, editable, and hands focus to the
  // textarea so the user can send as-is or adjust it first. The drawer has already
  // closed itself (and restored focus to its opener) by the time this runs, so the
  // synchronous focus call here is the one that sticks.
  const pickPrompt = useCallback((text: string, picked: string) => {
    setDraft(text);
    setRoleSlug(picked);
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
        body: JSON.stringify({
          message,
          threadId: threadId.current,
          // Sent every turn: the server holds no role state, and the chip is what the
          // user can see, so what it shows is what the turn is asked as.
          ...(role ? { role: role.role } : {}),
        }),
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
  }, [appendPart, busy, draft, role]);

  const lastStep = busy ? lastStepOf(turns) : undefined;

  return (
    <div className="app">
      <header>
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
            {roles.length > 0 && (
              <div className="ask-as">
                <p className="hint">{ROLE_HEADING}</p>
                <div className="role-pills">
                  {roles.map((view) => (
                    <button
                      key={view.roleSlug}
                      type="button"
                      className="role-pill"
                      // Selects only — no dialog springs open from what looks like a
                      // filter. The chip's own ▾ is the next step, and it now means
                      // something.
                      onClick={() => setRoleSlug(view.roleSlug === roleSlug ? "" : view.roleSlug)}
                      aria-pressed={view.roleSlug === roleSlug}
                      title={view.role}
                      aria-label={view.role}
                    >
                      {/* `roleSlug` is built from the role's initials on the MCP side. */}
                      {view.roleSlug.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>
            )}
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
        {/* The only door into the drawer, and the one place the chosen role is visible.
            Hidden entirely when there is no library — no door to an empty room. */}
        {roles.length > 0 && (
          <div className="chip-row">
            <button type="button" className="chip" onClick={openDrawer} aria-haspopup="dialog">
              {role ? (
                <>
                  <span className="chip-lead">{ROLE_CHIP_LEAD}</span> {role.role}
                </>
              ) : (
                ROLE_CHIP_EMPTY
              )}
              <span aria-hidden="true">▾</span>
            </button>
            {role && (
              <button
                type="button"
                className="chip-clear"
                onClick={() => setRoleSlug("")}
                aria-label={ROLE_CLEAR_LABEL}
                title={ROLE_CLEAR_LABEL}
              >
                ×
              </button>
            )}
          </div>
        )}

        <div className="composer-row">
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
        </div>
      </form>

      <RolesDrawer
        open={drawerOpen}
        datasets={library}
        busy={busy}
        role={roleSlug}
        onRoleChange={setRoleSlug}
        onPick={pickPrompt}
        onClose={closeDrawer}
      />
    </div>
  );
}
