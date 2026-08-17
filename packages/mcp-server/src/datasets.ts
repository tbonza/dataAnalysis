import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  ASSETS_DIRNAME,
  DATASET_ASSET_EXTENSION,
  DATASETS_SKILL_NAME,
  REFERENCES_DIRNAME,
} from "./constants.js";
import { parseSkillFile, skillsDirectory, type Skill } from "./skills.js";

/**
 * The packaged-dataset catalog: rows live under `datasets/assets/`, never loaded into
 * context, paired one-to-one with a documentation page under `datasets/references/`
 * that *is* loaded into context. This module is the only code that reads an asset.
 */

export function datasetsSkill(skills: Skill[]): Skill | undefined {
  return skills.find((skill) => skill.name === DATASETS_SKILL_NAME);
}

const DATASET_NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** A lowercase slug, safe to use as a bare filename with no traversal. */
export function isValidDatasetName(name: string): boolean {
  return DATASET_NAME_RE.test(name) && name.length <= 64;
}

function assetsDir(): string {
  return join(skillsDirectory, DATASETS_SKILL_NAME, ASSETS_DIRNAME);
}

function referencesDir(): string {
  return join(skillsDirectory, DATASETS_SKILL_NAME, REFERENCES_DIRNAME);
}

export function assetPathFor(name: string): string {
  return join(assetsDir(), `${name}${DATASET_ASSET_EXTENSION}`);
}

export function referencePathFor(name: string): string {
  return join(referencesDir(), `${name}.md`);
}

/** Read and parse one dataset's rows. The only function in this module that opens an asset. */
export function loadDatasetRows(name: string): Record<string, unknown>[] {
  const text = readFileSync(assetPathFor(name), "utf8");
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

export interface DatasetCatalogEntry {
  name: string;
  description: string;
  referenceUri: string;
}

function assetNames(): string[] {
  let entries: string[];
  try {
    entries = readdirSync(assetsDir());
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.endsWith(DATASET_ASSET_EXTENSION))
    .map((entry) => entry.slice(0, -DATASET_ASSET_EXTENSION.length))
    .sort();
}

/**
 * Build the catalog from what's on disk, at startup. Never opens an asset — the
 * catalog is `{ name, description, referenceUri }` only, so cost is independent of
 * how large the proprietary data is. A dataset missing its reference doc, its
 * `description`, or its pairing throws naming the offending file: a startup failure,
 * not a silent gap in the catalog.
 */
export function buildCatalog(skill: Skill | undefined): DatasetCatalogEntry[] {
  if (!skill) return [];

  return assetNames().map((name) => {
    const relativePath = `${REFERENCES_DIRNAME}/${name}.md`;
    const reference = skill.references.find((r) => r.relativePath === relativePath);
    if (!reference) {
      throw new Error(
        `Dataset "${name}" has an asset (assets/${name}${DATASET_ASSET_EXTENSION}) but no matching ` +
          `reference doc (references/${name}.md).`
      );
    }

    const { frontmatter } = parseSkillFile(reference.text);
    const description = frontmatter["description"];
    if (typeof description !== "string" || description.length === 0) {
      throw new Error(`Dataset reference "${relativePath}" is missing a non-empty description.`);
    }

    return { name, description, referenceUri: reference.uri };
  });
}
