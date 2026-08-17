import { AGENT_URL, PROMPTS_PATH } from "./constants.js";

/** The shape `GET /prompts` returns: the executive prompt library, dataset -> role -> prompt. */

export interface LibraryPrompt {
  name: string;
  title: string;
  text: string;
}

export interface RoleGroup {
  role: string;
  roleSlug: string;
  description: string;
  prompts: LibraryPrompt[];
}

export interface DatasetGroup {
  dataset: string;
  description: string;
  roles: RoleGroup[];
}

/** One role across every dataset it has prompts for. Roles are grouped per dataset on the
 *  wire; both the empty state and the drawer want the flip — the user chooses *who they
 *  are* first, then sees that role's questions. */
export interface RoleView {
  roleSlug: string;
  role: string;
  description: string;
  datasets: Array<{ dataset: string; description: string; prompts: LibraryPrompt[] }>;
}

export function rolesAcross(datasets: DatasetGroup[]): RoleView[] {
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

/** Fetch the library once. Any failure resolves to `[]` — the app degrades to a plain
 *  composer rather than blocking on a server that may not be up yet. */
export async function fetchLibrary(): Promise<DatasetGroup[]> {
  try {
    const res = await fetch(`${AGENT_URL}${PROMPTS_PATH}`);
    if (!res.ok) return [];
    const body = (await res.json()) as { datasets?: DatasetGroup[] };
    return body.datasets ?? [];
  } catch {
    return [];
  }
}
