import { DATA_READY_LABEL } from "./constants.js";
import type { DatasetGroup } from "./library.js";

/** What the log shows before the first question: which data is loaded and nothing else.
 *  The role is already set and visible on the composer chip, so there is nothing to ask
 *  the visitor before they type. */
export function EmptyState({ datasets }: { datasets: DatasetGroup[] }): React.ReactElement {
  return (
    <div className="empty">
      {datasets.map((group) => (
        <p key={group.dataset} className="data-ready">
          <span className="label">{DATA_READY_LABEL}</span> <code>{group.dataset}</code>
          {group.description && <> — {group.description}</>}
        </p>
      ))}
    </div>
  );
}
