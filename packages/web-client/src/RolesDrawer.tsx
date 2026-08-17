import { useEffect, useMemo, useRef } from "react";
import {
  DRAWER_CLOSE_LABEL,
  DRAWER_EMPTY,
  DRAWER_TITLE,
  ROLE_ANY_LABEL,
  ROLE_HEADING,
  ROLE_PICK_HINT,
} from "./constants.js";
import { rolesAcross, type DatasetGroup } from "./library.js";

/**
 * The left flyout: the executive prompt library as a native `<dialog>` docked to the left
 * edge. `showModal()` gives focus trap, Esc-to-close, backdrop and focus-return for free.
 *
 * One dropdown scopes the panel to a single role's questions. Listing every role at once
 * made the panel something to scan rather than something to use — and the full cast is
 * already on show in the empty state, so the drawer doesn't have to carry that job.
 * Picking a question hands its text and its role to the caller and nothing else.
 */
export function RolesDrawer({
  open,
  datasets,
  busy,
  role,
  onRoleChange,
  onPick,
  onClose,
}: {
  open: boolean;
  datasets: DatasetGroup[];
  busy: boolean;
  /** The selected role's slug, or "" for none — owned by the caller, since the composer
   *  chip shows the same state. */
  role: string;
  onRoleChange: (roleSlug: string) => void;
  onPick: (text: string, roleSlug: string) => void;
  onClose: () => void;
}): React.ReactElement {
  const dialog = useRef<HTMLDialogElement>(null);
  const roles = useMemo(() => rolesAcross(datasets), [datasets]);
  const selected = roles.find((view) => view.roleSlug === role);

  // Guard on `dialog.open` both ways: closing fires the native `close` event, which calls
  // `onClose`, which sets `open=false` — without the guard that would call `close()` on an
  // already-closed dialog (harmless, but noisy) or re-open one.
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    else if (!open && element.open) element.close();
  }, [open]);

  // Listen for the native `close` event directly: it fires for Esc (via `cancel`), for
  // `close()` and for form-method=dialog submits, and it does not bubble — so it is the one
  // place every close path converges to keep `open` in sync.
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    element.addEventListener("close", onClose);
    return () => element.removeEventListener("close", onClose);
  }, [onClose]);

  // Close first, then hand over the text: closing restores focus to whatever opened the
  // drawer, and the caller wants to move focus to the composer *after* that.
  const pick = (text: string, roleSlug: string) => {
    dialog.current?.close();
    onPick(text, roleSlug);
  };

  return (
    <dialog
      ref={dialog}
      className="drawer"
      aria-label={DRAWER_TITLE}
      // The dialog itself has no padding, so a click whose target is the dialog element
      // (not a descendant) can only be on the backdrop.
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="drawer-body">
        <div className="drawer-head">
          <h2>{DRAWER_TITLE}</h2>
          <button type="button" className="ghost" onClick={onClose}>
            {DRAWER_CLOSE_LABEL}
          </button>
        </div>

        {roles.length === 0 ? (
          <p className="hint">{DRAWER_EMPTY}</p>
        ) : (
          <>
            <label className="role-select">
              <span>{ROLE_HEADING}</span>
              <select value={role} onChange={(event) => onRoleChange(event.target.value)}>
                {/* "" is a real state, not a placeholder: it means answer plainly, which
                    is what the agent does when no role is named. */}
                <option value="">{ROLE_ANY_LABEL}</option>
                {roles.map((view) => (
                  <option key={view.roleSlug} value={view.roleSlug}>
                    {view.role}
                  </option>
                ))}
              </select>
            </label>

            {!selected ? (
              <p className="hint">{ROLE_PICK_HINT}</p>
            ) : (
              <div className="role-detail">
                {selected.description && <p className="hint">{selected.description}</p>}
                {selected.datasets.map((group) => (
                  <div key={group.dataset}>
                    {/* One dataset today, so naming it here would only repeat what the
                        empty state already says, and encode no distinction. */}
                    {selected.datasets.length > 1 && (
                      <h4>
                        <code>{group.dataset}</code>
                      </h4>
                    )}
                    <ul>
                      {group.prompts.map((prompt) => (
                        <li key={prompt.name}>
                          <button
                            type="button"
                            className="prompt"
                            disabled={busy}
                            onClick={() => pick(prompt.text, selected.roleSlug)}
                          >
                            {prompt.text}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </dialog>
  );
}
