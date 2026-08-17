import { ROLE_CHIP_EMPTY, ROLE_CHIP_LEAD, ROLE_CLEAR_LABEL } from "./constants.js";

/**
 * The current role, sitting on the composer because that is what it modifies: the
 * message about to be sent. It is also the only way into the prompt library, so its
 * label is state — the destination when no role is set, the choice when one is.
 */
export function RoleChip({
  role,
  onOpen,
  onClear,
}: {
  /** The role's display name, or "" when the answer should be unframed. */
  role: string;
  onOpen: () => void;
  onClear: () => void;
}): React.ReactElement {
  return (
    <div className="chip-row">
      <button type="button" className="chip" onClick={onOpen} aria-haspopup="dialog">
        {role ? (
          <>
            <span className="chip-lead">{ROLE_CHIP_LEAD}</span> {role}
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
          onClick={onClear}
          aria-label={ROLE_CLEAR_LABEL}
          title={ROLE_CLEAR_LABEL}
        >
          ×
        </button>
      )}
    </div>
  );
}
