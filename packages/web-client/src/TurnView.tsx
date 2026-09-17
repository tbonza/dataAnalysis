import { Chart } from "./Chart.js";
import { CopyButton } from "./CopyButton.js";
import { Trail } from "./Trail.js";
import { groupParts, type Turn } from "./turns.js";

/** One turn in the log. Charts and text render where the agent produced them; runs of
 *  tool calls collapse into a `Trail`. */
export function TurnView({ turn }: { turn: Turn }): React.ReactElement {
  return (
    <article className={turn.role}>
      {groupParts(turn.parts).map((part, index) => {
        switch (part.kind) {
          case "text":
            return part.report ? (
              <div key={index} className="report">
                <p>{part.text}</p>
                <CopyButton text={part.text} />
              </div>
            ) : (
              <p key={index}>{part.text}</p>
            );
          case "error":
            return (
              <p key={index} className="error">
                {part.message}
              </p>
            );
          case "trail":
            return <Trail key={index} steps={part.steps} />;
          case "chart":
            return <Chart key={`${part.chartId}-${index}`} chartId={part.chartId} spec={part.spec} />;
        }
      })}
    </article>
  );
}
