import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * `pnpm preview-chart <spec.json> [out.html]`
 *
 * Render a Vega-Lite spec so a human can look at it.
 *
 * Neither server rasterizes — they return specs, and the web client turns them into
 * pixels. That client only talks to the agent server, which needs cloud credentials, so
 * checking a spec by eye used to mean running three services. This writes a
 * self-contained page instead: open the file, see the chart. It is a local development
 * aid and no part of the MCP surface.
 */

const VEGA_CDN = "https://cdn.jsdelivr.net/npm";

function page(title: string, spec: unknown): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<script src="${VEGA_CDN}/vega@6"></script>
<script src="${VEGA_CDN}/vega-lite@6"></script>
<script src="${VEGA_CDN}/vega-embed@7"></script>
<style>
  body { font: 14px system-ui, sans-serif; margin: 0; padding: 24px; background: #fafafa; }
  h1 { font-size: 15px; font-weight: 600; margin: 0 0 16px; color: #333; }
  #chart { background: #fff; padding: 16px; border: 1px solid #e5e5e5; border-radius: 6px; display: inline-block; }
  #error { color: #b00; white-space: pre-wrap; font-family: ui-monospace, monospace; }
</style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>
<div id="chart"></div>
<div id="error"></div>
<script>
  const spec = ${JSON.stringify(spec)};
  vegaEmbed("#chart", spec, { actions: { export: true, source: true, editor: true } })
    .catch((err) => { document.getElementById("error").textContent = String(err && err.stack || err); });
</script>
</body>
</html>
`;
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c
  );
}

/**
 * Write a standalone HTML page rendering `spec` and return its path. A chart result
 * from `create_chart` is accepted whole — its `vlSpec` is unwrapped — so a tool response
 * can be piped straight in without editing.
 */
export function writePreview(spec: unknown, outPath?: string): string {
  const unwrapped =
    spec && typeof spec === "object" && "vlSpec" in spec
      ? (spec as { vlSpec: unknown }).vlSpec
      : spec;
  if (!unwrapped || typeof unwrapped !== "object") {
    throw new Error("That is not a Vega-Lite spec: expected an object, or one with a `vlSpec`.");
  }
  const title =
    (spec as { chartType?: string })?.chartType ??
    ((unwrapped as { title?: unknown }).title as string | undefined) ??
    "Chart preview";
  const target =
    outPath ?? join(mkdtempSync(join(tmpdir(), "chart-preview-")), "chart.html");
  writeFileSync(
    target,
    page(typeof title === "string" ? title : "Chart preview", unwrapped),
    "utf8"
  );
  return target;
}

async function main(): Promise<void> {
  const [input, outPath] = process.argv.slice(2);
  if (!input) {
    throw new Error("Usage: pnpm preview-chart <spec.json> [out.html]");
  }
  const raw = readFileSync(resolve(input), "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${input} is not valid JSON.`);
  }
  const target = writePreview(parsed, outPath ? resolve(outPath) : undefined);
  console.log(`Wrote ${basename(target)} — open it in a browser:\n\nfile://${target}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
