import { trailSummary } from "./constants.js";
import type { Step } from "./turns.js";

/** The agent's tool calls for one stretch of a turn, folded: one line closed, the full
 *  trace when opened. Seeing the loop work is useful, but it isn't the answer. */
export function Trail({ steps }: { steps: Step[] }): React.ReactElement {
  return (
    <details className="trail">
      <summary>{trailSummary(steps.map((step) => step.name))}</summary>
      <ol>
        {steps.map((step, index) => (
          <li key={index}>
            <span className="step-name">{step.name}</span>
            {step.detail && <span className="step-detail">{step.detail}</span>}
          </li>
        ))}
      </ol>
    </details>
  );
}
