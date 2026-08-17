import { useEffect, useMemo, useRef, useState } from "react";
import { DRAWER_CLOSE_LABEL, DRAWER_EMPTY, DRAWER_TITLE, ROLE_SELECT_LABEL } from "./constants.js";
import type { DatasetGroup, RoleGroup } from "./library.js";

/** One role across every dataset it has prompts for — the unit the drawer's selector
 *  picks between. Roles are grouped per dataset on the wire; the drawer flips that so
 *  the user chooses *who they are* first, then sees that role's questions per dataset. */
interface RoleView {
  roleSlug: string;
  role: string;
  description: string;
  datasets: Array<{ dataset: string; description: string; prompts: RoleGroup["prompts"] }>;
}

function rolesAcross(datasets: DatasetGroup[]): RoleView[] {
  const bySlug = new Map<string, RoleView>();
  for (const group of datasets) {
    for (const role of group.roles) {
      let view = bySlug.get(role.roleSlug);
      if (!view) {
        view = { roleSlug: role.roleSlug, role: role.role, description: role.description, datasets: [] };
        bySlug.set(role.roleSlug, view);
      }
      view.datasets.push({ dataset: group.dataset, description: group.description, prompts: role.prompts });
    }
  }
  return [...bySlug.values()];
}

/**
 * The left flyout: the executive prompt library as a native `<dialog>` docked to the
 * left edge. `showModal()` gives focus trap, Esc-to-close, backdrop and focus-return
 * for free. A role selector at the top (first role pre-selected) scopes the list to
 * one role's questions. Picking a prompt hands its text to the caller and nothing
 * else — the caller decides what to do with the text.
 */
export function RolesDrawer({
  open,
  datasets,
  busy,
  onPick,
  onClose,
}: {
  open: boolean;
  datasets: DatasetGroup[];
  busy: boolean;
  onPick: (text: string) => void;
  onClose: () => void;
}): React.ReactElement {
  const dialog = useRef<HTMLDialogElement>(null);
  const roles = useMemo(() => rolesAcross(datasets), [datasets]);

  // The chosen role survives close/reopen; "" means "no choice yet", which resolves
  // to the first role — so there is always a selection once the library has loaded.
  const [chosen, setChosen] = useState("");
  const selected = roles.find((r) => r.roleSlug === chosen) ?? roles[0];

  // Guard on `dialog.open` both ways: closing fires the native `close` event, which
  // calls `onClose`, which sets `open=false` — without the guard that would call
  // `close()` on an already-closed dialog (harmless, but noisy) or re-open one.
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    else if (!open && element.open) element.close();
  }, [open]);

  // Listen for the native `close` event directly: it fires for Esc (via `cancel`),
  // for `close()` and for form-method=dialog submits, and it does not bubble — so it
  // is the one place every close path converges to keep `open` in sync.
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    element.addEventListener("close", onClose);
    return () => element.removeEventListener("close", onClose);
  }, [onClose]);

  // Close first, then hand over the text: closing restores focus to whatever opened
  // the drawer, and the caller wants to move focus to the composer *after* that.
  const pick = (text: string) => {
    dialog.current?.close();
    onPick(text);
  };

  return (
    <dialog
      ref={dialog}
      className="drawer"
      aria-label={DRAWER_TITLE}
      // The dialog itself has no padding, so a click whose target is the dialog
      // element (not a descendant) can only be on the backdrop.
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

        {!selected ? (
          <p className="hint">{DRAWER_EMPTY}</p>
        ) : (
          <>
            <label className="drawer-select">
              <span>{ROLE_SELECT_LABEL}</span>
              <select value={selected.roleSlug} onChange={(event) => setChosen(event.target.value)}>
                {roles.map((role) => (
                  <option key={role.roleSlug} value={role.roleSlug}>
                    {role.role}
                  </option>
                ))}
              </select>
            </label>
            {selected.description && <p className="hint drawer-brief">{selected.description}</p>}

            {selected.datasets.map((group) => (
              <section key={group.dataset} className="drawer-dataset">
                <h3>
                  <code>{group.dataset}</code>
                </h3>
                {group.description && <p className="hint">{group.description}</p>}
                <ul>
                  {group.prompts.map((prompt) => (
                    <li key={prompt.name}>
                      <button
                        type="button"
                        className="prompt"
                        disabled={busy}
                        onClick={() => pick(prompt.text)}
                      >
                        {prompt.text}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </>
        )}
      </div>
    </dialog>
  );
}
