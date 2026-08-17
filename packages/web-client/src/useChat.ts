import { useCallback, useRef, useState } from "react";
import { streamChat } from "./chat.js";
import { partFor, withPart, type Turn } from "./turns.js";

/**
 * One conversation: the turns so far, whether a turn is in flight, and a way to send.
 *
 * The thread id lives for the page's lifetime, so a follow-up like "make the bars green"
 * can see the chart the previous turn made.
 */
export function useChat(role: string | undefined): {
  turns: Turn[];
  busy: boolean;
  send: (message: string) => Promise<void>;
} {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const threadId = useRef(crypto.randomUUID());

  const send = useCallback(
    async (raw: string): Promise<void> => {
      const message = raw.trim();
      if (!message || busy) return;

      setBusy(true);
      setTurns((current) => [...current, { role: "user", parts: [{ kind: "text", text: message }] }]);

      const append = (part: Parameters<typeof withPart>[1]): void => {
        setTurns((current) => withPart(current, part));
      };

      try {
        // The role is sent on every turn: the server holds no role state, so what the
        // chip shows is what the turn is asked as.
        await streamChat({ message, threadId: threadId.current, ...(role ? { role } : {}) }, (event) => {
          const part = partFor(event);
          if (part) append(part);
        });
      } catch (err) {
        append({ kind: "error", message: err instanceof Error ? err.message : String(err) });
      } finally {
        setBusy(false);
      }
    },
    [busy, role]
  );

  return { turns, busy, send };
}
