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
  | { kind: "text"; text: string; delta?: true }
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
      return event.delta ? { kind: "text", text: event.text, delta: true } : { kind: "text", text: event.text };
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
 *  user's. Pure — returns a new array, mutating nothing.
 *
 *  A token delta merges into the text part it is continuing, so a streamed answer is one
 *  paragraph rather than one per token. Only deltas merge: two whole `text` blocks, or a
 *  report following an answer, stay separate. */
export function withPart(turns: Turn[], part: Part): Turn[] {
  const last = turns[turns.length - 1];
  if (!last || last.role !== "assistant") return [...turns, { role: "assistant", parts: [part] }];

  const open = last.parts[last.parts.length - 1];
  if (part.kind === "text" && part.delta && open?.kind === "text" && open.delta) {
    const merged: Part = { kind: "text", text: open.text + part.text, delta: true };
    return [...turns.slice(0, -1), { ...last, parts: [...last.parts.slice(0, -1), merged] }];
  }
  return [...turns.slice(0, -1), { ...last, parts: [...last.parts, part] }];
}

export function groupParts(parts: Part[]): Rendered[] {
  const out: Rendered[] = [];
  // Every tool call in the turn joins the same trail, wherever it lands, and the trail
  // renders where the first one did. Folding only *consecutive* calls used to give the
  // same result, but only because prose always arrived last; now that the model streams
  // its tokens as it writes them, a sentence can land between two calls and would
  // otherwise split one "N steps" line into two.
  let trail: Extract<Rendered, { kind: "trail" }> | undefined;
  for (const part of parts) {
    if (part.kind !== "tool") {
      out.push(part);
      continue;
    }
    if (trail) trail.steps.push(part.step);
    else {
      trail = { kind: "trail", steps: [part.step] };
      out.push(trail);
    }
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
