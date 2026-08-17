import { JOB_ROLES_SKILL_NAME, RECOMMENDED_PROMPT_KIND } from "./constants.js";
import { parseSkillFile, type Skill } from "./skills.js";

/**
 * The executive prompt library: one recommended prompt per role per dataset it
 * targets, parsed from `job-roles`' reference-doc frontmatter. Rendered both as MCP
 * prompts (so `claude mcp add` puts them in Claude Code's own picker) and as plain
 * data over `GET /prompts` (so the web client can render the same library).
 */

export interface RolePrompt {
  role: string;
  roleSlug: string;
  /** A user-facing one-line brief for the role: the first sentence of the role doc's
   *  body (the persona), not its `description` — that field is agent-facing ("Use
   *  whenever the user is speaking as…") and reads oddly in a menu. */
  roleBrief: string;
  dataset: string;
  title: string;
  text: string;
}

export function jobRoles(skills: Skill[]): Skill | undefined {
  return skills.find((skill) => skill.name === JOB_ROLES_SKILL_NAME);
}

/** "Chief Revenue Officer" -> "cro". Deterministic, and short enough to read in a prompt name. */
function slugForRole(role: string): string {
  return role
    .split(/\s+/)
    .map((word) => word[0])
    .join("")
    .toLowerCase();
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** The first sentence of the first prose paragraph of a Markdown body — headings
 *  skipped, hard-wrapped lines joined — or "" if there isn't one. Role docs are
 *  written so that opening sentence stands alone ("Optimizes for …"). */
function firstSentenceOf(body: string): string {
  const paragraphs = body.split(/\n\s*\n/).map((p) => p.trim());
  const prose = paragraphs.find((p) => p.length > 0 && !p.startsWith("#"));
  if (!prose) return "";
  const joined = prose.replace(/\s*\n\s*/g, " ");
  const end = joined.search(/[.!?](\s|$)/);
  return end === -1 ? joined : joined.slice(0, end + 1);
}

interface RawPrompt {
  dataset?: unknown;
  title?: unknown;
  text?: unknown;
}

/**
 * Parse every role reference doc's frontmatter once at startup and flatten it into
 * one entry per prompt. A role doc missing `role`, a malformed `prompts` entry, or an
 * empty `title`/`text` throws naming the offending file — a startup failure, not a
 * silently thin library.
 */
export function buildPromptLibrary(skill: Skill | undefined): RolePrompt[] {
  if (!skill) return [];

  const prompts: RolePrompt[] = [];
  for (const reference of skill.references) {
    const { frontmatter, body } = parseSkillFile(reference.text);
    const role = frontmatter["role"];
    if (typeof role !== "string" || role.length === 0) {
      throw new Error(`Role reference "${reference.relativePath}" is missing a non-empty "role".`);
    }
    const roleSlug = slugForRole(role);
    const roleBrief = firstSentenceOf(body);
    if (roleBrief.length === 0) {
      throw new Error(`Role reference "${reference.relativePath}" needs a persona paragraph in its body.`);
    }

    const raw = frontmatter["prompts"];
    if (!Array.isArray(raw) || raw.length === 0) {
      throw new Error(`Role reference "${reference.relativePath}" needs at least one prompt.`);
    }

    for (const [index, entry] of (raw as RawPrompt[]).entries()) {
      const dataset = entry.dataset;
      const title = entry.title;
      const text = entry.text;
      if (typeof dataset !== "string" || dataset.length === 0) {
        throw new Error(`${reference.relativePath} prompts[${index}] is missing a "dataset".`);
      }
      if (typeof title !== "string" || title.length === 0) {
        throw new Error(`${reference.relativePath} prompts[${index}] is missing a "title".`);
      }
      if (typeof text !== "string" || text.trim().length === 0) {
        throw new Error(`${reference.relativePath} prompts[${index}] is missing "text".`);
      }
      prompts.push({
        role,
        roleSlug,
        roleBrief,
        dataset,
        title,
        text: text.trim(),
      });
    }
  }
  return prompts;
}

/** Single-underscore style, matching the existing `load_<skill>_skill` prompts. */
export function promptNameFor(prompt: RolePrompt): string {
  return [prompt.roleSlug, slugify(prompt.dataset), slugify(prompt.title)].filter(Boolean).join("_");
}

/** Goes into each registration's `_meta`, and is what the picker groups on. */
export function promptMetaFor(prompt: RolePrompt): {
  kind: typeof RECOMMENDED_PROMPT_KIND;
  dataset: string;
  role: string;
  roleSlug: string;
  roleBrief: string;
} {
  return {
    kind: RECOMMENDED_PROMPT_KIND,
    dataset: prompt.dataset,
    role: prompt.role,
    roleSlug: prompt.roleSlug,
    roleBrief: prompt.roleBrief,
  };
}
