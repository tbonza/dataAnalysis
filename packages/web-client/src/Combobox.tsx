import { useEffect, useId, useMemo, useRef, useState } from "react";

export interface ComboboxOption {
  value: string;
  label: string;
}

/**
 * A text input that filters a list as you type, with the closest match highlighted and
 * selectable by Enter — what a `<select>` can't do, since native type-ahead only matches
 * from the start of an option and every role here begins with the same word.
 *
 * Generic over its options on purpose: nothing here knows about roles.
 */
export function Combobox({
  options,
  value,
  onChange,
  label,
  placeholder,
  emptyLabel,
  onOpenChange,
}: {
  options: ComboboxOption[];
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder: string;
  emptyLabel: string;
  /** Told whenever the list opens or closes, so an enclosing `<dialog>` can tell an
   *  Escape meant for the list from one meant for itself. */
  onOpenChange?: (open: boolean) => void;
}): React.ReactElement {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);

  const [open, setOpen] = useState(false);
  /** What the user has typed, or null when the field is simply showing the selection. */
  const [query, setQuery] = useState<string | null>(null);
  const [active, setActive] = useState(0);

  const selectedLabel = options.find((option) => option.value === value)?.label ?? "";

  const matches = useMemo(() => {
    const needle = query?.trim().toLowerCase() ?? "";
    if (!needle) return options;
    return options.filter((option) => option.label.toLowerCase().includes(needle));
  }, [options, query]);

  // Keep the highlighted row in view once the list is long enough to scroll.
  useEffect(() => {
    if (!open) return;
    list.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const openList = (): void => {
    if (open) return;
    setOpen(true);
    onOpenChange?.(true);
    const index = options.findIndex((option) => option.value === value);
    setActive(index === -1 ? 0 : index);
  };

  /** Opening to browse empties the field so the first keystroke filters from scratch
   *  instead of appending to the name already sitting there. The selection moves to the
   *  placeholder, and the list marks it, so it stays readable. Clearing rather than
   *  select()-ing is deliberate: the browser places the caret on mouseup, after the click
   *  handler, and would undo a selection made here. */
  const openForBrowsing = (): void => {
    openList();
    setQuery("");
  };

  const closeList = (): void => {
    if (!open) return;
    setOpen(false);
    onOpenChange?.(false);
    setQuery(null);
  };

  const commit = (option: ComboboxOption): void => {
    onChange(option.value);
    closeList();
    input.current?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!open) openForBrowsing();
      else setActive((index) => Math.min(index + 1, matches.length - 1));
    } else if (event.key === "ArrowUp") {
      if (!open) return;
      event.preventDefault();
      setActive((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter") {
      if (!open) return;
      event.preventDefault();
      const option = matches[active];
      if (option) commit(option);
    } else if (event.key === "Escape") {
      if (!open) return;
      // The first Escape dismisses the list, not an enclosing dialog. Stopping the event
      // here keeps the drawer open; `onOpenChange` covers browsers that treat Escape as a
      // close request regardless.
      event.preventDefault();
      event.stopPropagation();
      closeList();
    }
  };

  const activeOption = open ? matches[active] : undefined;

  return (
    <div className="combobox">
      <label htmlFor={`${id}-input`}>{label}</label>
      <input
        id={`${id}-input`}
        ref={input}
        type="text"
        role="combobox"
        autoComplete="off"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        {...(activeOption ? { "aria-activedescendant": `${id}-option-${activeOption.value}` } : {})}
        placeholder={query !== null && selectedLabel ? selectedLabel : placeholder}
        value={query ?? selectedLabel}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
          openList();
        }}
        onKeyDown={onKeyDown}
        onClick={openForBrowsing}
        onBlur={closeList}
      />

      {open && (
        <ul id={`${id}-list`} ref={list} role="listbox" aria-label={label}>
          {matches.length === 0 ? (
            <li className="combobox-empty">{emptyLabel}</li>
          ) : (
            matches.map((option, index) => (
              <li
                key={option.value}
                id={`${id}-option-${option.value}`}
                role="option"
                aria-selected={option.value === value}
                className={index === active ? "active" : undefined}
                // mousedown, not click: blur would otherwise close the list out from
                // under the pointer before the click landed.
                onMouseDown={(event) => {
                  event.preventDefault();
                  commit(option);
                }}
                onMouseEnter={() => setActive(index)}
              >
                {option.label}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
