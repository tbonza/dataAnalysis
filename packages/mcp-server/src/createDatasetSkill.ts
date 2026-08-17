import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { assetPathFor, isValidDatasetName, referencePathFor } from "./datasets.js";

/**
 * `pnpm create-dataset <name> [--from <path>]`
 *
 * Adds a dataset to the existing `datasets` skill; it never creates a skill
 * directory. A scaffolder, not a sync tool — refuses if the dataset already exists
 * rather than overwriting it.
 */

interface Args {
  name: string;
  from: string | undefined;
}

function parseArgs(argv: string[]): Args {
  const [name, ...rest] = argv;
  if (!name) {
    throw new Error("Usage: pnpm create-dataset <name> [--from <path>]");
  }
  const fromIndex = rest.indexOf("--from");
  const from = fromIndex === -1 ? undefined : rest[fromIndex + 1];
  if (fromIndex !== -1 && !from) {
    throw new Error("--from needs a path argument.");
  }
  return { name, from };
}

/** A `.json` array of row objects, or a `.jsonl` file — the same shapes `loadDatasetRows` reads. */
function readRowsFrom(path: string): Record<string, unknown>[] {
  const text = readFileSync(path, "utf8");

  if (path.endsWith(".jsonl")) {
    const rows = text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    if (rows.length === 0) throw new Error(`${path} has no rows.`);
    return rows;
  }

  if (path.endsWith(".json")) {
    const parsed: unknown = JSON.parse(text);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      throw new Error(`${path} must be a non-empty JSON array of row objects.`);
    }
    return parsed as Record<string, unknown>[];
  }

  throw new Error(`${path}: --from needs a .json or .jsonl file.`);
}

function placeholderRows(): Record<string, unknown>[] {
  return [{ TODO_column: "TODO value", TODO_metric: 0 }];
}

/** `name` + `typeof` for the first row, so the author edits real column names rather
 *  than guessing the table's shape. */
function columnTable(rows: Record<string, unknown>[]): string {
  const columns = Object.entries(rows[0]!).map(([name, value]) => `| ${name} | ${typeof value} |`);
  return ["| column | type |", "|---|---|", ...columns].join("\n");
}

function referenceDoc(name: string, rows: Record<string, unknown>[]): string {
  return [
    "---",
    "description: >-",
    "  TODO: describe this dataset in one or two sentences. Use when TODO — say what",
    "  questions it can answer, so an agent can tell whether it fits before loading it.",
    "---",
    "",
    `# ${name}`,
    "",
    `${rows.length} row(s). TODO: describe how this dataset was assembled and any caveats.`,
    `Load it with \`load_available_dataset({ name: "${name}" })\` — this file documents the`,
    "shape; the asset behind it is never read directly.",
    "",
    "## Fields",
    "",
    "TODO: replace the inferred types below with real column descriptions.",
    "",
    columnTable(rows),
    "",
  ].join("\n");
}

function main(): void {
  const { name, from } = parseArgs(process.argv.slice(2));

  if (!isValidDatasetName(name)) {
    throw new Error(`"${name}" is not a valid dataset name — lowercase letters, digits, single hyphens.`);
  }

  const assetPath = assetPathFor(name);
  const referencePath = referencePathFor(name);
  if (existsSync(assetPath) || existsSync(referencePath)) {
    throw new Error(`Dataset "${name}" already exists. This scaffolds new datasets; it doesn't update them.`);
  }

  const rows = from ? readRowsFrom(from) : placeholderRows();

  mkdirSync(dirname(assetPath), { recursive: true });
  mkdirSync(dirname(referencePath), { recursive: true });
  writeFileSync(assetPath, rows.map((row) => JSON.stringify(row)).join("\n") + "\n", "utf8");
  writeFileSync(referencePath, referenceDoc(name, rows), "utf8");

  console.log(`Wrote assets/${name}.jsonl and references/${name}.md.`);
  console.log("Next steps:");
  console.log(`  1. Fill in the TODOs in skills/datasets/references/${name}.md (description, column notes).`);
  console.log(`  2. If real rows weren't provided via --from, replace the placeholder row in`);
  console.log(`     skills/datasets/assets/${name}.jsonl.`);
  console.log(`  3. Add prompts for "${name}" to whichever job-roles references should recommend it.`);
  console.log("  4. pnpm test");
  console.log("  5. Restart pnpm mcp.");
}

try {
  main();
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
