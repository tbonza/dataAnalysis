import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Composer } from "./Composer.js";
import { EmptyState } from "./EmptyState.js";
import { RoleChip } from "./RoleChip.js";
import { RolesDrawer } from "./RolesDrawer.js";
import { TurnView } from "./TurnView.js";
import { APP_TAGLINE, APP_TITLE, WORKING_LABEL } from "./constants.js";
import { defaultRoleSlug, fetchLibrary, rolesAcross, type DatasetGroup } from "./library.js";
import { lastStepOf } from "./turns.js";
import { useChat } from "./useChat.js";

export function App(): React.ReactElement {
  const [draft, setDraft] = useState("");
  const [library, setLibrary] = useState<DatasetGroup[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  /** The role the next message is asked as, by slug. "" means answer plainly. */
  const [roleSlug, setRoleSlug] = useState("");

  const scroller = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);

  const roles = useMemo(() => rolesAcross(library), [library]);
  const role = roles.find((view) => view.roleSlug === roleSlug);

  const { turns, busy, send } = useChat(role?.role);

  // The library is fetched once and shared by the drawer and the chip. Selecting a
  // default here rather than in `useState` is what makes it possible at all: the roles
  // aren't known until this resolves.
  useEffect(() => {
    let cancelled = false;
    void fetchLibrary().then((datasets) => {
      if (cancelled) return;
      setLibrary(datasets);
      setRoleSlug(defaultRoleSlug(datasets));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Follow the tail of the log as a turn streams in.
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [turns]);

  const openDrawer = useCallback(() => setDrawerOpen(true), []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);
  const clearRole = useCallback(() => setRoleSlug(""), []);

  // Picking never sends — it fills the composer, editable, and hands focus to the
  // textarea so the user can send as-is or adjust it first. The drawer has already closed
  // itself (and restored focus to its opener) by the time this runs, so the synchronous
  // focus call here is the one that sticks.
  const pickPrompt = useCallback((text: string, picked: string) => {
    setDraft(text);
    setRoleSlug(picked);
    setDrawerOpen(false);
    textarea.current?.focus();
  }, []);

  const submit = useCallback(() => {
    const message = draft;
    setDraft("");
    void send(message);
  }, [draft, send]);

  const lastStep = busy ? lastStepOf(turns) : undefined;

  return (
    <div className="app">
      <header>
        <strong>{APP_TITLE}</strong>
        <span>{APP_TAGLINE}</span>
      </header>

      <div className="log" ref={scroller}>
        {turns.length === 0 && <EmptyState datasets={library} />}

        {turns.map((turn, index) => (
          <TurnView key={index} turn={turn} />
        ))}

        {busy && (
          <p className="hint working">
            {WORKING_LABEL}
            {lastStep && <span className="step-name">{lastStep.name}</span>}
          </p>
        )}
      </div>

      <Composer
        draft={draft}
        busy={busy}
        onDraftChange={setDraft}
        onSend={submit}
        textareaRef={textarea}
      >
        {/* The only door into the drawer. Hidden when there is no library — no door to an
            empty room. */}
        {roles.length > 0 && (
          <RoleChip role={role?.role ?? ""} onOpen={openDrawer} onClear={clearRole} />
        )}
      </Composer>

      <RolesDrawer
        open={drawerOpen}
        datasets={library}
        busy={busy}
        role={roleSlug}
        onRoleChange={setRoleSlug}
        onPick={pickPrompt}
        onClose={closeDrawer}
      />
    </div>
  );
}
