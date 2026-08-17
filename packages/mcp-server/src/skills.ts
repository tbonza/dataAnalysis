import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import {
  REFERENCES_DIRNAME,
  SKILL_FILENAME,
  SKILL_URI_PREFIX,
  SKILLS_DIRNAME,
  ALLOWED_FRONTMATTER_FIELDS,
} from "./constants.js";

/**
 * Agent Skills loader (https://agentskills.io/specification).
 *
 * The skills are the portable part of this server: a consuming agent reads them to
 * learn how to author a query and a chart, so they travel where our tool
 * descriptions alone would not. They are served over MCP as resources — the same
 * approach flint-chart-mcp takes with `flint://agent-skill`.
 */

export { ALLOWED_FRONTMATTER_FIELDS, SKILL_URI_PREFIX };

export interface SkillReference {
  /** Path relative to the skill root, e.g. "references/chart-types.md". */
  relativePath: string;
  uri: string;
  text: string;
}

export interface Skill {
  name: string;
  description: string;
  /** Directory name, which the spec requires to equal `name`. */
  directory: string;
  frontmatter: Record<string, unknown>;
  /** The Markdown body, frontmatter removed. */
  body: string;
  /** The whole file, as served. */
  text: string;
  uri: string;
  references: SkillReference[];
}

const SKILLS_DIR = fileURLToPath(new URL(`../${SKILLS_DIRNAME}`, import.meta.url));

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export interface ParsedSkillFile {
  frontmatter: Record<string, unknown>;
  body: string;
}

/** Split `---` frontmatter from the body. Exported so the compliance test uses the same
 *  parser — and so does `prompts.ts` for role reference docs, which is why these messages
 *  say "skill file" rather than naming SKILL.md. */
export function parseSkillFile(text: string): ParsedSkillFile {
  const match = FRONTMATTER.exec(text);
  if (!match) throw new Error("A skill file must begin with `---` YAML frontmatter.");
  const parsed: unknown = parseYaml(match[1] ?? "");
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Skill file frontmatter must be a YAML mapping.");
  }
  return { frontmatter: parsed as Record<string, unknown>, body: match[2] ?? "" };
}

function readReferences(skillDir: string, skillName: string): SkillReference[] {
  const dir = join(skillDir, REFERENCES_DIRNAME);
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.endsWith(".md"))
    .sort()
    .map((entry) => ({
      relativePath: `${REFERENCES_DIRNAME}/${entry}`,
      uri: `${SKILL_URI_PREFIX}${skillName}/${REFERENCES_DIRNAME}/${entry}`,
      text: readFileSync(join(dir, entry), "utf8"),
    }));
}

/**
 * Read every skill once, at startup. `createMcpHandler` builds a server per
 * request, so this must not be per-request work.
 */
export function loadSkills(): Skill[] {
  let directories: string[];
  try {
    directories = readdirSync(SKILLS_DIR).filter((entry) =>
      statSync(join(SKILLS_DIR, entry)).isDirectory()
    );
  } catch {
    return [];
  }

  const skills: Skill[] = [];
  for (const directory of directories.sort()) {
    const skillDir = join(SKILLS_DIR, directory);
    let text: string;
    try {
      text = readFileSync(join(skillDir, SKILL_FILENAME), "utf8");
    } catch {
      continue; // A directory without a SKILL.md is not a skill.
    }

    const { frontmatter, body } = parseSkillFile(text);
    const name = typeof frontmatter["name"] === "string" ? frontmatter["name"] : directory;
    const description =
      typeof frontmatter["description"] === "string" ? frontmatter["description"] : "";

    skills.push({
      name,
      description,
      directory,
      frontmatter,
      body,
      text,
      uri: `${SKILL_URI_PREFIX}${name}`,
      references: readReferences(skillDir, name),
    });
  }
  return skills;
}

/** Absolute path to the skills directory, for the compliance test. */
export const skillsDirectory = SKILLS_DIR;
