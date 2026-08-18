import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentEvent } from "./chat.js";
import { groupParts, partFor, withPart, type Part, type Turn } from "./turns.js";

/** The parts a run of events produces, as the log would hold them. */
function log(events: AgentEvent[]): Part[] {
  let turns: Turn[] = [{ role: "user", parts: [{ kind: "text", text: "q" }] }];
  for (const event of events) {
    const part = partFor(event);
    if (part) turns = withPart(turns, part);
  }
  return turns[turns.length - 1]!.parts;
}

const delta = (text: string): AgentEvent => ({ type: "text", text, delta: true });
const tool = (name: string): AgentEvent => ({ type: "tool", name });

describe("streamed text", () => {
  it("merges consecutive deltas into one part, whitespace and all", () => {
    assert.deepEqual(log([delta("Revenue "), delta("is up "), delta("12%.")]), [
      { kind: "text", text: "Revenue is up 12%.", delta: true },
    ]);
  });

  it("keeps a whole text block separate from a streamed one", () => {
    const parts = log([delta("Streamed."), { type: "text", text: "Whole." }]);
    assert.deepEqual(parts, [
      { kind: "text", text: "Streamed.", delta: true },
      { kind: "text", text: "Whole." },
    ]);
  });

  it("does not swallow a report into the answer above it", () => {
    const parts = log([delta("Here it is."), { type: "report", markdown: "# Report" }]);
    assert.equal(parts.length, 2);
    assert.deepEqual(parts[1], { kind: "text", text: "# Report" });
  });

  it("starts a new part when a chart interrupts the prose", () => {
    const parts = log([
      delta("First. "),
      { type: "chart", chartId: "c1", vlSpec: {} },
      delta("Second."),
    ]);
    assert.deepEqual(parts.map((p) => p.kind), ["text", "chart", "text"]);
    assert.deepEqual(parts[2], { kind: "text", text: "Second.", delta: true });
  });
});

describe("the tool trail", () => {
  it("folds every call in the turn into one line, even when prose lands between them", () => {
    const rendered = groupParts(log([tool("query"), delta("Charting. "), tool("create_chart")]));
    const trails = rendered.filter((part) => part.kind === "trail");
    assert.equal(trails.length, 1, "one collapsed trail per turn, as the README promises");
    assert.deepEqual(trails[0]!.steps.map((s) => s.name), ["query", "create_chart"]);
  });

  it("renders the trail where the first call happened, leaving text and charts in place", () => {
    const rendered = groupParts(
      log([delta("Looking. "), tool("query"), { type: "chart", chartId: "c1", vlSpec: {} }, tool("create_chart")])
    );
    assert.deepEqual(rendered.map((part) => part.kind), ["text", "trail", "chart"]);
  });
});
