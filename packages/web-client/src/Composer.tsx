import { COMPOSER_PLACEHOLDER, SEND_LABEL } from "./constants.js";

/**
 * The message box. `children` render as an accessory row above the input — today that is
 * the role chip, but the component takes no view on what goes there.
 */
export function Composer({
  draft,
  busy,
  onDraftChange,
  onSend,
  textareaRef,
  children,
}: {
  draft: string;
  busy: boolean;
  onDraftChange: (draft: string) => void;
  onSend: () => void;
  textareaRef?: React.RefObject<HTMLTextAreaElement | null>;
  children?: React.ReactNode;
}): React.ReactElement {
  return (
    <form
      className="composer"
      onSubmit={(event) => {
        event.preventDefault();
        onSend();
      }}
    >
      {children}

      <div className="composer-row">
        <textarea
          ref={textareaRef}
          value={draft}
          rows={3}
          placeholder={COMPOSER_PLACEHOLDER}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              onSend();
            }
          }}
        />
        <button type="submit" disabled={busy || draft.trim().length === 0}>
          {SEND_LABEL}
        </button>
      </div>
    </form>
  );
}
