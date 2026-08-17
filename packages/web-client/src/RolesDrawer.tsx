import { useEffect, useRef } from "react";
import { DRAWER_CLOSE_LABEL, DRAWER_EMPTY, DRAWER_TITLE } from "./constants.js";
import type { DatasetGroup } from "./library.js";

/**
 * The left flyout: the executive prompt library as a native `<dialog>` docked to the
 * left edge. `showModal()` gives focus trap, Esc-to-close, backdrop and focus-return
 * for free. Picking a prompt hands its text to the caller and nothing else — the
 * caller closes the drawer and decides what to do with the text.
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

        {datasets.length === 0 ? (
          <p className="hint">{DRAWER_EMPTY}</p>
        ) : (
          datasets.map((group) => (
            <section key={group.dataset} className="drawer-dataset">
              <h3>
                <code>{group.dataset}</code>
              </h3>
              {group.description && <p className="hint">{group.description}</p>}

              {group.roles.map((role) => (
                <div key={role.roleSlug} className="drawer-role">
                  <h4>{role.role}</h4>
                  {role.description && <p className="hint">{role.description}</p>}
                  <ul>
                    {role.prompts.map((prompt) => (
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
                </div>
              ))}
            </section>
          ))
        )}
      </div>
    </dialog>
  );
}
