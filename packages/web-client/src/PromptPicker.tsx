import { useEffect, useState } from "react";
import { AGENT_URL, PROMPTS_PATH } from "./constants.js";

interface LibraryPrompt {
  name: string;
  title: string;
  text: string;
}

interface RoleGroup {
  role: string;
  roleSlug: string;
  prompts: LibraryPrompt[];
}

interface DatasetGroup {
  dataset: string;
  roles: RoleGroup[];
}

/**
 * The executive prompt library, fetched once and rendered dataset -> role -> prompt.
 * Picking an entry hands its text to the caller and does nothing else — no selection
 * state, no load call. Loading a dataset is the agent's job once the user sends the
 * (editable) prompt; this component only ever writes into the composer.
 */
export function PromptPicker({
  onPick,
  busy,
}: {
  onPick: (text: string) => void;
  busy: boolean;
}): React.ReactElement | null {
  const [datasets, setDatasets] = useState<DatasetGroup[]>([]);

  useEffect(() => {
    let cancelled = false;
    void fetch(`${AGENT_URL}${PROMPTS_PATH}`)
      .then((res) => (res.ok ? (res.json() as Promise<{ datasets?: DatasetGroup[] }>) : { datasets: [] }))
      .then((body) => {
        if (!cancelled) setDatasets(body.datasets ?? []);
      })
      .catch(() => {
        if (!cancelled) setDatasets([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (datasets.length === 0) return null;

  return (
    <div className="picker">
      {datasets.map((group) => (
        <section key={group.dataset}>
          <h2>{group.dataset}</h2>
          {group.roles.map((role) => (
            <div key={role.roleSlug} className="picker-role">
              <h3>{role.role}</h3>
              <div className="picker-prompts">
                {role.prompts.map((prompt) => (
                  <button
                    key={prompt.name}
                    type="button"
                    disabled={busy}
                    onClick={() => onPick(prompt.text)}
                  >
                    {prompt.title}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
