import type { AgentEvent } from "./chat.js";

/**
 * The conversation as the log renders it, and the pure functions that shape it. No React
 * and no I/O, so the mapping from stream events to rendered parts can be reasoned about
 * (and tested) on its own.
 */

export interface Step {
  name: string;
  detail?: string;
}

export type Part =
  | { kind: "text"; text: string }
  | { kind: "tool"; step: Step }
  | { kind: "chart"; chartId: string; spec: Record<string, unknown> }
  | { kind: "error"; message: string };

export interface Turn {
  role: "user" | "assistant";
  /** Rendered in order, so a chart appears where the agent produced it. */
  parts: Part[];
}

/** Rendered form of a turn: consecutive tool calls fold into one collapsed trail, so the
 *  ReAct loop is visible on demand without interleaving every step with the answer. Text
 *  and charts stay exactly where they were. */
export type Rendered = Exclude<Part, { kind: "tool" }> | { kind: "trail"; steps: Step[] };

/** One stream event as a log part, or `undefined` for events that aren't rendered
 *  (`done`, which only ends the turn). */
export function partFor(event: AgentEvent): Part | undefined {
  switch (event.type) {
    case "text":
      return { kind: "text", text: event.text };
    case "report":
      return { kind: "text", text: event.markdown };
    case "tool":
      return {
        kind: "tool",
        step: event.detail ? { name: event.name, detail: event.detail } : { name: event.name },
      };
    case "chart":
      return { kind: "chart", chartId: event.chartId, spec: event.vlSpec };
    case "error":
      return { kind: "error", message: event.message };
    case "done":
      return undefined;
  }
}

/** Append to the assistant's turn in progress, starting one if the last turn is the
 *  user's. Pure — returns a new array, mutating nothing. */
export function withPart(turns: Turn[], part: Part): Turn[] {
  const last = turns[turns.length - 1];
  if (!last || last.role !== "assistant") return [...turns, { role: "assistant", parts: [part] }];
  return [...turns.slice(0, -1), { ...last, parts: [...last.parts, part] }];
}

export function groupParts(parts: Part[]): Rendered[] {
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
export function lastStepOf(turns: Turn[]): Step | undefined {
  const last = turns[turns.length - 1];
  if (!last || last.role !== "assistant") return undefined;
  for (let i = last.parts.length - 1; i >= 0; i--) {
    const part = last.parts[i];
    if (part && part.kind === "tool") return part.step;
  }
  return undefined;
}
