import { useEffect, useRef, useState } from "react";
import { copyText } from "./clipboard.js";

type Status = "idle" | "copied" | "failed";

const REVERT_MS = 1500;

const LABEL: Record<Status, string> = {
  idle: "Copy",
  copied: "Copied",
  failed: "Copy failed",
};

/** Copies `text` to the clipboard on click, with a transient status label instead of a
 *  silent no-op or a thrown error the user never sees. */
export function CopyButton({ text }: { text: string }): React.ReactElement {
  const [status, setStatus] = useState<Status>("idle");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const onClick = () => {
    copyText(text).then(
      () => setStatus("copied"),
      () => setStatus("failed")
    );
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setStatus("idle"), REVERT_MS);
  };

  return (
    <button type="button" className="ghost copy" onClick={onClick}>
      {LABEL[status]}
    </button>
  );
}
