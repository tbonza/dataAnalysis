import { join } from "node:path";
import { DATASETS_SKILL_NAME, REFERENCES_DIRNAME } from "./constants.js";
import { listCatalogTableNames } from "./duckdb.js";
import { parseSkillFile, skillsDirectory, type Skill } from "./skills.js";

/**
 * The packaged-dataset catalog: tables live in the prebuilt, read-only database
 * `pnpm build-catalog` produces from parquet (see buildCatalog.ts) — never opened by
 * this module or by the live server. Each table is paired one-to-one with a
 * documentation page under `datasets/references/` that *is* loaded into context.
 */

export function datasetsSkill(skills: Skill[]): Skill | undefined {
  return skills.find((skill) => skill.name === DATASETS_SKILL_NAME);
}

const DATASET_NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** A lowercase slug, safe to use as a bare filename or table name with no traversal. */
export function isValidDatasetName(name: string): boolean {
  return DATASET_NAME_RE.test(name) && name.length <= 64;
}

function referencesDir(): string {
  return join(skillsDirectory, DATASETS_SKILL_NAME, REFERENCES_DIRNAME);
}

export function referencePathFor(name: string): string {
  return join(referencesDir(), `${name}.md`);
}

export interface DatasetCatalogEntry {
  name: string;
  description: string;
  referenceUri: string;
}

function referenceNameOf(relativePath: string): string | undefined {
  if (!relativePath.startsWith(`${REFERENCES_DIRNAME}/`) || !relativePath.endsWith(".md")) {
    return undefined;
  }
  return relativePath.slice(REFERENCES_DIRNAME.length + 1, -".md".length);
}

/**
 * Build the catalog from the tables actually present in the attached, read-only
 * catalog database (see duckdb.ts's `listCatalogTableNames`) — this module never opens
 * a parquet file or the database file directly; only `buildCatalog.ts`'s offline build
 * step does. A table with no matching `references/<name>.md`, or a reference doc with
 * no matching table, throws naming the offending name: a startup failure, not a silent
 * gap in the catalog.
 */
export async function buildCatalog(skill: Skill | undefined): Promise<DatasetCatalogEntry[]> {
  if (!skill) return [];

  const tableNames = await listCatalogTableNames();
  const referenceNames = skill.references
    .map((r) => referenceNameOf(r.relativePath))
    .filter((name): name is string => name !== undefined);

  const missingDoc = tableNames.filter((name) => !referenceNames.includes(name));
  if (missingDoc.length) {
    throw new Error(
      `Catalog table(s) ${missingDoc.join(", ")} have no matching reference doc ` +
        `(references/<name>.md) in the datasets skill. Run "pnpm build-catalog" to scaffold one.`
    );
  }
  const missingTable = referenceNames.filter((name) => !tableNames.includes(name));
  if (missingTable.length) {
    throw new Error(
      `Reference doc(s) ${missingTable.join(", ")} have no matching table in the catalog database. ` +
        `Run "pnpm build-catalog" to rebuild it, or remove the stale doc.`
    );
  }

  return tableNames.map((name) => {
    const relativePath = `${REFERENCES_DIRNAME}/${name}.md`;
    const reference = skill.references.find((r) => r.relativePath === relativePath)!;
    const { frontmatter } = parseSkillFile(reference.text);
    const description = frontmatter["description"];
    if (typeof description !== "string" || description.length === 0) {
      throw new Error(`Dataset reference "${relativePath}" is missing a non-empty description.`);
    }
    return { name, description, referenceUri: reference.uri };
  });
}
