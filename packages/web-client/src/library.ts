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
