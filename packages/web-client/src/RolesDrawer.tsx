import { useEffect, useMemo, useRef, useState } from "react";
import { Combobox, type ComboboxOption } from "./Combobox.js";
import {
  DRAWER_CLOSE_LABEL,
  DRAWER_EMPTY,
  DRAWER_TITLE,
  ROLE_ANY_LABEL,
  ROLE_LABEL,
  ROLE_NO_MATCH,
  ROLE_PICK_HINT,
  ROLE_SEARCH_PLACEHOLDER,
} from "./constants.js";
import { rolesAcross, type DatasetGroup } from "./library.js";

/**
 * The left flyout: the executive prompt library as a native `<dialog>` docked to the left
 * edge. `showModal()` gives focus trap, Esc-to-close, backdrop and focus-return for free.
 *
 * A type-to-filter picker scopes the panel to one role's questions. Listing every role at
 * once made the panel something to scan rather than something to use. Picking a question
 * hands its text and its role to the caller and nothing else.
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
  const [pickerOpen, setPickerOpen] = useState(false);

  const roles = useMemo(() => rolesAcross(datasets), [datasets]);
  const selected = roles.find((view) => view.roleSlug === role);

  const options = useMemo<ComboboxOption[]>(
    () => [
      // "" is a real state, not a placeholder: it means answer plainly, which is what the
      // agent does when no role is named.
      { value: "", label: ROLE_ANY_LABEL },
      ...roles.map((view) => ({ value: view.roleSlug, label: view.role })),
    ],
    [roles]
  );

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
  const pick = (text: string, roleSlug: string): void => {
    dialog.current?.close();
    onPick(text, roleSlug);
  };

  return (
    <dialog
      ref={dialog}
      className="drawer"
      aria-label={DRAWER_TITLE}
      // While the picker's list is open, Escape belongs to the list. The Combobox stops
      // the key event, but browsers that raise the close request anyway land here.
      onCancel={(event) => {
        if (pickerOpen) event.preventDefault();
      }}
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
            <Combobox
              options={options}
              value={role}
              onChange={onRoleChange}
              onOpenChange={setPickerOpen}
              label={ROLE_LABEL}
              placeholder={ROLE_SEARCH_PLACEHOLDER}
              emptyLabel={ROLE_NO_MATCH}
            />

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
