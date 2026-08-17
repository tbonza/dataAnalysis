# Plan: a normalized MCP surface, packaged datasets, and an executive prompt library

## Context

This started as two asks — consolidate configuration, and let users pick pre-loaded proprietary
datasets instead of pasting rows into chat — and the design was corrected three times during
planning: one skill per dataset became one `datasets` skill, job roles became their own skill, the
picker became a prompt library rather than a dataset list, and a review of the resulting API added
a normalization pass over the existing tool surface. Only the final shape is described here.
Hazards found by reviewing drafts against the code are collected under **Landmines**; several are
silent failures, so that section is worth reading before starting.

Work Part 0 first — it rewrites the surface the rest of the plan adds to.

1. **No file-upload path.** The datasets are proprietary. `load_data` (inline rows authored in
   chat) stays exactly as-is, but there is no CSV/file-upload widget, and the web UI offers a
   picker instead of asking the user to describe data.
2. **All datasets live in one `datasets` skill.** One skill per dataset was rejected: every skill
   costs an entry in the metadata tier each agent sees at startup, so N datasets would drown out
   the capability skills. Instead one skill holds them all, using the spec's own two-directory
   split — `references/<name>.md` documenting each dataset (loaded into context on demand) paired
   with `assets/<name>.jsonl` holding its rows (never loaded into context).
3. **Job role is a separate concept from dataset, so it is a separate skill.** `job-roles` holds
   one reference doc per role. Each doc carries the persona — what that executive optimizes for
   and how they want an answer framed, which is genuine skill content the agent reads — plus that
   role's recommended prompts, each naming the dataset it targets.
4. **The picker is a library of recommended prompts, not a dataset list**, organized dataset →
   role → prompt. Because prompts are authored per role and grouped per dataset, the grouping is
   a join computed at startup, and a test asserts every prompt names a dataset that exists.
5. **The MCP tool surface is normalized to camelCase.** Reviewing the proposed API surfaced that
   the boundary is snake_case (`dataset_id`, `vl_spec`) while everything the boundary wraps is
   already camelCase — `Dataset.rowCount`, `Chart.vlSpec`, and the agent-authored `ChartSpec` and
   `QuerySpec` schemas. The snake boundary is what forces the hand-mapping in `server.ts`, and it
   is not even applied consistently: `list_chart_types` and `create_report` already return
   camelCase nested payloads, which is why `agent-server/src/server.ts:41` reads both `vl_spec` and
   `vlSpec`. One convention removes the mapping layer and the dual-key reader. This is a **breaking
   change** to tool inputs as well as outputs, so anything already pointed at the server has to be
   re-pointed.
6. **Configuration lives in one `constants.ts` per package**, not scattered as inline
   `process.env.X ?? default` and magic literals.

The through-line: the MCP server is the product, so everything portable — data, role framing, and
now the prompt library itself — is expressed in MCP primitives rather than in this repo's client.

## Decisions

- **Two new skills, `datasets` and `job-roles`**, both using `references/` for what the agent may
  read and `assets/` for what it may not. Eight skills total.
- **Nothing about this needs new loader machinery.** `readReferences` (`skills.ts:68`) already
  reads `references/*.md` into `Skill.references` at startup, and `server.ts:70` already registers
  each as its own MCP resource at `priority: 0.5`. Dataset docs and role docs become addressable
  resources for free; `assets/` stays unregistered and unreadable by the agent, which is the point
  of putting rows there.
- **Neither `SKILL.md` enumerates its contents.** `datasets/SKILL.md` explains the loop
  (`list_available_datasets` → read the dataset's reference → `load_available_dataset`);
  `job-roles/SKILL.md` explains
  that each reference is a role and to read the one the user is speaking as. Any hand-written list
  would drift from disk; the generated tool output and resource list cannot.
- **Frontmatter carries the structured metadata**, parsed with the existing `parseSkillFile`
  (`skills.ts:58`) against reference text `readReferences` has already loaded — no extra file
  reads, no new parser, no third file per dataset. Dataset docs carry `description:`; role docs
  carry `role:`, `description:`, and `prompts:`. **`description`, not `summary`** — it is the
  spec's word for a one-line what-and-when, it is what `SKILL.md` already uses, and it is the
  field name in the tool output, so one concept keeps one name end to end.
- **The prompt library is served as MCP prompts** — `registerPrompt`, which `server.ts:88` already
  uses for skills. Pointing Claude Code at the server puts the executive library in its own
  slash-command picker with nothing inherited from this repo. No bespoke prompt-library resource.
  Verified against the installed SDK (`@modelcontextprotocol/server` 2.0.0): the registration
  config accepts `{ title, description, argsSchema, icons, _meta }`, and `_meta` is an open object
  that the server passes through verbatim to `prompts/list`. So the picker's dataset → role
  grouping travels as structured metadata rather than being parsed back out of prompt names.
  Prompts get no `annotations`/`audience` (only resources and tools do), which is why `_meta`
  carries the grouping and the library is not marked user-audience the way a resource could be.
- **The catalog and the library are built once at startup**, next to `SKILLS` in `server.ts`.
  `createMcpHandler` builds a server per request (`skills.ts:87`), so per-call asset reads would
  re-parse every dataset on every `list_available_datasets`.
- **A packaged dataset and a loaded dataset are named differently, because they are different
  things.** The catalog tools are `list_available_datasets` and `load_available_dataset`;
  "available" marks the pre-load stage. A catalog entry is identified by `name`
  (`regional-sales`) and never carries a `datasetId`; `load_available_dataset` is what mints one,
  after which `inspect_dataset`/`query`/`create_chart` take `datasetId` as they do today. Without
  this split, `inspect_dataset({ datasetId: "regional-sales" })` reads like it should work. For
  the same reason, **rename `duckdb.ts:175`'s `listDatasets()` → `listLoadedDatasets()`** — zero
  call sites (declared in `duckdb.ts`, re-exported at `index.ts:9`, used nowhere), a two-line
  rename.
- **`load_available_dataset`'s `name` is a `z.enum(datasetNames)`** built at startup from the
  asset listing, so every dataset is visible in the tool schema itself — the one discovery path
  that works for a consuming agent that never reads resources. Both catalog tools are skipped
  when there are no datasets, since zod rejects `z.enum([])`.
- **The catalog returns `{ name, description, referenceUri }` and nothing else.** An earlier draft
  also returned `columns` and `rowCount`, which duplicated `inspect_dataset` — and `columns` as a
  `string[]` contradicted the `{ name, type }[]` shape that field has everywhere else. Neither has
  a consumer now that the picker shows prompts rather than columns. Dropping them means
  `buildCatalog` reads only the reference docs at startup and **never touches the proprietary rows
  at all**; column detail comes from `referenceUri`, and real column types from
  `inspect_dataset` after loading.
- **The catalog does not return prompt text.** Recommended prompts are a human affordance; an
  agent paying context for them gains nothing. Role framing reaches the agent through the
  `job-roles` reference docs it reads on demand.
- **The picker writes the prompt; it does not load anything.** Choosing a recommended prompt
  inserts its text into the composer, editable, and that is the whole interaction — no selection
  state, no client-side load call, nothing to keep in sync with the thread. Loading stays the
  agent's job, which keeps every capability in the MCP surface where another team's agent
  inherits it. What the picker replaces is *pasting rows*: the composer starts empty and no copy
  invites the user to describe data. `load_data` stays on the MCP surface untouched for consuming
  agents; the web client just stops advertising it.
- **`constants.ts` scope**: env-driven config with defaults, cross-file shared identifiers, and
  named tunables. Not domain lookup tables that belong with their logic (`CHART_TYPE_ALIASES`,
  `COMPARISON_OPERATORS`, `AGGREGATE_OPS`, `COMPUTE_OPS`), not prose blocks (`INSTRUCTIONS`,
  `SYSTEM_PROMPT`), not HTTP status codes or SSE wire literals (`"\n\n"`, `"data: "`).
- **One `constants.ts` per package, not a shared module.** Genuinely cross-package values (the MCP
  URL/port, the `chart://skill/` prefix, the `"chart"` server name, port 5173) stay duplicated,
  one copy per package, each commented with its counterpart.

## Part 0 — normalize the tool surface to camelCase

Do this **first**, before anything else, so the new tools are written once in their final shape
rather than added in snake_case and renamed. It is mechanical but wide, and it is the one part of
this plan that changes an existing contract.

**Scope: field names only. Tool names stay snake_case.** `load_data`, `create_chart`,
`list_chart_types` and the rest keep their names, and the new tools follow suit
(`list_available_datasets`, `load_available_dataset`). Tool names are identifiers in a different
namespace from a payload's fields, snake_case is the MCP ecosystem norm for them, and every skill
doc, the CLI and the README reference them by name — renaming those buys nothing and risks a lot.

**The fifteen renames**, all at the top level of a tool's `inputSchema`/`outputSchema` in
`server.ts`:

```
dataset_id -> datasetId          chart_spec        -> chartSpec
source_dataset_id -> sourceDatasetId              vl_spec -> vlSpec
row_count -> rowCount            semantic_types    -> semanticTypes
sample_rows -> sampleRows        theme_spec        -> themeSpec
preview_rows -> previewRows      spec_without_data -> specWithoutData
chart_id -> chartId              data_sample       -> dataSample
chart_type -> chartType          config_ui         -> configUI
chart_types -> chartTypes
```

`config_ui` becomes **`configUI`**, not `configUi` — that is what the internals already call it
(`chart.ts`, `restyle.ts`, `configUI.ts`). A naive camelizer gets this one wrong.

Because the internals are already camelCase, most of `server.ts`'s handlers collapse: the mapping
layer (`dataset_id: dataset.id`, `vl_spec: chart.vlSpec`, destructures like
`async ({ dataset_id, chart_spec })`) becomes shorthand or disappears. Same in `cli.ts`, where the
local variables are already `datasetId`/`chartId`/`vlSpec`, so `{ dataset_id: datasetId }` reduces
to `{ datasetId }`.

**This must be a targeted rename of the keys `server.ts` itself declares — never a repo-wide
case transform.** The exclusion list, worst first:

1. **`chart.ts:150-163` is a *different* boundary that looks exactly like ours.** The call into
   `assembleVegaLite` passes `semantic_types:`, `theme_spec:` and `chart_spec:` because **flint's**
   `ChartAssemblyInput` requires snake_case at its top level (confirmed in
   `flint-chart/dist/types-BWc1W3v4.d.ts`). The object is cast with
   `as Parameters<typeof assembleVegaLite>[0]`, so **TypeScript will not catch a rename here** —
   charts would silently assemble unthemed and unannotated. Exclude these lines explicitly.
2. **`chart_type` → `chartType` collides by name with a pre-existing spec key.** `ChartSpec` already
   has `chartType` (`schemas.ts:44`, and every JSON example in `chart-author/SKILL.md`), which is
   flint's. The targeted rename is safe; a blind `chartType` → anything sweep is not. Afterwards
   `chart-author/SKILL.md` legitimately contains `chartType` in two roles — a key inside `chartSpec`,
   and a response field.
3. **Underscore-prefixed keys are load-bearing.** `restyle.ts:13-15`'s `stripPrivateKeys` pairs with
   `chart.ts:182-185` reading `vlSpec["_warnings"]`, and those warnings feed `validate.ts:63-64`,
   which decides `valid`. Touching the `_` convention changes correctness, not naming.
4. **`FORBIDDEN_PATH_SEGMENTS` (`configUI.ts:16`)** — `__proto__`, `prototype`, `constructor` are
   literal JavaScript names guarding against prototype pollution, checked at `:29`, `:116`, `:126`.
   Case-normalizing them silently disables the guard.
5. **Snake_case *values* stay put**: the `CHART_TYPE_ALIASES` inputs `grouped_bar`/`world_map`/
   `us_map`/`group_bar`/`worldmap`/`usmap` (`chart.ts:18-39`) are accepted agent input, so changing
   them changes behaviour; `count_distinct` is an aggregate operator (`query.ts:51`); Vega-Lite keys
   like `data`, `mark`, `opacity` and every `ConfigControl.path` segment are foreign vocabulary; and
   every data column in the examples (`total_revenue`, `unit_price`, `avg_unit_price`,
   `blended_price`, `show_values`) is user data. These share lines with real renames — e.g.
   `semantic_types: { region: "Region", total_revenue: "Amount" }`, where the key renames and the
   value does not.
6. **`chart_types` → `chartTypes` must not touch the `list_chart_types` tool name**, which appears in
   `chart-author/SKILL.md`, `chart-types.md`, `data-analysis/SKILL.md`, `server.ts`, `validate.ts`,
   and `chart.test.ts`.
7. **`notes.md` documents data-formulator's own API**; its `chart_type` mentions are a foreign
   project's. Exclude it from any repo-wide pass.

**Strings that name boundary fields also move**: the error text `Unknown dataset_id`
(`duckdb.ts:170`) and `Unknown chart_id` (`chart.ts:83`, asserted by `chart.test.ts:99`), the
restyle warnings quoting `configUI` (`restyle.ts:87`, `:95`), the tool descriptions inside
`server.ts` that name fields in prose (`:228-229`, `:368-369`, `:464`), and the explanatory comments
at `report.ts:8`, `schemas.ts:4`, `chart.ts:107`.

**Where the renames land** (61 hits, ~57 real):

- `packages/mcp-server/src/server.ts` — every tool's schemas plus the handler mapping.
- `packages/mcp-server/src/cli.ts` — 21 lines, the densest single file: request payload keys and
  response reads.
- **The six skills, nine Markdown files — the highest-risk surface, because no test checks a stale
  field name in prose.** `chart-author/SKILL.md` (9 lines, including the canonical input JSON and
  three worked examples), `chart-restyle/SKILL.md` (7, the tool signatures for both restyle steps),
  `theme-author/SKILL.md` (5, **including its YAML frontmatter `description`**, which is
  machine-read for skill discovery), `data-query/references/query-spec.md` (5, a column-aligned
  result-shape block that needs re-padding), `data-analysis/SKILL.md` (4),
  `data-query/SKILL.md` (3), `report/SKILL.md` (2), and one line each in
  `chart-author/references/{chart-types,semantic-types}.md`.
- `packages/mcp-server/src/chart.test.ts:99` — asserts on the error text `Unknown chart_id "…"`
  from `chart.ts:83`. Either leave both, or move them together.
- `packages/agent-server/src/server.ts:41-47` — `chartEventsFrom`'s dual reads. **`chart_type` at
  `:46` has no camelCase fallback**, unlike `vl_spec`/`chart_id`, so the chart-type label silently
  disappears the moment the server emits `chartType`. That line must change; once it does, the
  snake branches on `:41`/`:45` become dead code and get dropped.

**Two things that need no changes at all**: `packages/web-client` (already camelCase — `App.tsx:10`
declares `chartId`/`chartType`/`vlSpec`, because the agent server normalizes) and `README.md`
(references tool names and `vlSpec` only). `create_report` also needs no output rename — it is
already camelCase, which is why the dual-key reader exists.

`report/SKILL.md` is worth calling out as the payoff: its JSON example already says `chartId` while
its prose says `chart_id`. After this pass the file agrees with itself.

While in here, close one documentation hole the sweep turned up: `sample_rows`/`sampleRows` (the
`inspect_dataset` response field) is named in no skill file at all. `data-analysis/SKILL.md:46`
describes the per-field summary without naming the field. One clause fixes it.

### The other half: stop re-declaring the same shapes

Consistency is only half the ask; the boundary also repeats itself, and in three places it declares
a shape it already has a schema for. Fixing this is what makes the surface self-describing to a
consuming agent, which is the whole point of the product.

- **`columns` is inlined three times** — `z.array(z.object({ name: z.string(), type: z.string() }))`
  at `server.ts:116`, `:147`, `:184`. There is already a `DatasetColumn` type (`duckdb.ts:6`). Add a
  `DatasetColumnSchema` to `schemas.ts` and reference it from all three.
- **`warnings` is declared as an untyped `z.record`** at `:251` and `:327`, even though `ChartWarning`
  (`schemas.ts:60-66`) is exactly that shape. Reference the real schema.
- **`valid`/`errors`/`warnings` are re-inlined** at `:249-251` although `ValidationResult`
  (`schemas.ts:107-111`) exists and is never used at the boundary. Reference it.
- **`vl_spec`/`vlSpec` is `z.record(z.string(), z.unknown())` in four places** (`:247`, `:326`,
  `:424`, `:432`). One named `VegaLiteSpec` schema, used four times, says "this is a Vega-Lite spec"
  instead of "this is some object".
- **`configUI` is `z.array(z.record(z.string(), z.unknown()))`** at `:426` and `:433`, so zod
  validates nothing about the controls an agent sends, and `sanitizeConfigUI` **silently drops**
  anything malformed (`configUI.ts:49`, `:54`, `:57`, `:80`, `:87`, `:97`) — the agent gets zero
  controls and a vague warning (`restyle.ts:95`) rather than an error. Referencing the existing
  `ConfigControl` (`schemas.ts:77-103`) means a malformed control is a schema error the agent can
  actually repair. **This is a deliberate behaviour change** — stricter input, clearer failure — and
  `sanitizeConfigUI` stays as defence in depth for the path-traversal guards, which zod cannot express.

Net effect: every tool's schema is assembled from named schemas in `schemas.ts` rather than
hand-inlined per tool, so two tools returning "columns" cannot drift apart, and a consuming agent
reading the tool list sees named types rather than anonymous records.

## Part 1 — `constants.ts` per package

**`constants.ts` must be a dependency-free leaf in every package.** `query.ts:94` uses
`MAX_RESULT_ROWS` inside a zod schema at module-eval time, so an import cycle would surface as a
confusing `undefined` in `.max()` rather than an error.

### `packages/mcp-server/src/constants.ts` (new)

`DEFAULT_PORT` (3000), `DEFAULT_HOST` (`127.0.0.1`), `PORT` (`process.env.PORT ?? DEFAULT_PORT`),
`HOST`, `DEFAULT_MCP_URL`, `MCP_SERVER_NAME` ("chart"), `MCP_SERVER_VERSION` ("1.0.0"),
`MAX_RESULT_ROWS` (5000, from `duckdb.ts:23`), `SUMMARY_SAMPLE_SIZE` (16), dataset id
prefix/length (`ds-`, 12), table name prefix/length/fallback (`ds_`, 40, 8, `"data"`), chart id
prefix/length (`chart-`, 12), `FALLBACK_CHART_TYPE` ("Scatter Plot"), `SKILL_URI_PREFIX`
("chart://skill/"), `ALLOWED_FRONTMATTER_FIELDS` (from `skills.ts:16`), `DATASETS_SKILL_NAME`
("datasets"), `JOB_ROLES_SKILL_NAME` ("job-roles"), `DATASET_ASSET_EXTENSION` (".jsonl"), and the
on-disk conventions `SKILL_FILENAME`, `REFERENCES_DIRNAME`, `ASSETS_DIRNAME`, `SKILLS_DIRNAME`.

Three separate row-sample constants, **not one** — they are `10` by coincidence, not by relation,
and collapsing them would couple unrelated knobs:

- `DEFAULT_SAMPLE_ROWS` — `duckdb.ts:208` `sampleRows`, rows sampled from a dataset.
- `RESTYLE_SAMPLE_ROWS` — `restyle.ts:26` `prepareRestyle`, rows of a chart's embedded data.
- `QUERY_PREVIEW_ROWS` — `server.ts:215` `preview_rows`, missed by the first inventory.

Files rewired: `duckdb.ts`, `query.ts` (currently imports `MAX_RESULT_ROWS` from `duckdb.ts` —
point it at `constants.ts`), `chart.ts`, `restyle.ts`, `skills.ts`, `server.ts`, `cli.ts`.

**`cli.ts:10` derives its default from `DEFAULT_MCP_URL`, not from `PORT`** — deriving from the
env-resolved `PORT` would silently repoint the CLI in any shell that has `PORT` set, where today
it is a fixed literal.

**`index.ts` must keep its public surface intact.** It re-exports `MAX_RESULT_ROWS` from
`./duckdb.js` and `ALLOWED_FRONTMATTER_FIELDS`/`SKILL_URI_PREFIX` from `./skills.js`; once those
move, both re-export sites fail to compile. Re-point them at `./constants.js`, rename the
`listDatasets` export to `listLoadedDatasets`, and add the new `datasets.ts`/`prompts.ts` helpers.

### `packages/agent-server/src/constants.ts` (new)

`MCP_URL`, `SERVER_NAME` ("chart" — comment noting it must match `mcp-server`'s
`MCP_SERVER_NAME`), `AGENT_PORT` (3001), `HOST`, `CLIENT_ORIGIN` (default
`http://127.0.0.1:5173`, comment noting it must match the web dev port), the `BEDROCK_MODEL_ID`
and `AWS_REGION` defaults from `model.ts`, `SKILLS_ROOT` ("/skills/"), `SKILL_URI_PREFIX`
(independent copy, per-package by design), `SKILL_FILENAME`, `RECURSION_LIMIT` (50),
`DEFAULT_THREAD_ID` ("default"), and the route paths `HEALTH_PATH`, `CHAT_PATH`, `DATASETS_PATH`,
`PROMPTS_PATH` declared together so they cannot drift.

Files rewired: `server.ts`, `agent.ts`, `model.ts`, `skills.ts` (drops its own copies of
`SKILL_URI_PREFIX` and the `SKILL.md` literals).

### `packages/web-client/src/constants.ts` (new)

`AGENT_URL` (`import.meta.env["VITE_AGENT_URL"] ?? http://127.0.0.1:3001`), `PROMPTS_PATH`,
`CHAT_PATH`, and the composer's placeholder/hint copy.

**`DEV_SERVER_PORT` stays inline in `vite.config.ts`, which does not import this file.**
`vite.config.ts` is bundled and run in plain Node, where `import.meta.env` is `undefined` —
importing a module that indexes it throws at init and `pnpm web` dies before the dev server
starts. `constants.ts` is browser-side only; 5173's real twin is `agent-server`'s `CLIENT_ORIGIN`,
cross-package and duplicated by design anyway.

Files rewired: `App.tsx`. `EXAMPLE` is retired, not moved. SSE framing stays inline — wire
mechanics shared *by construction* with `agent-server/src/server.ts`'s `send()`.

## Part 2 — The `datasets` skill

```
packages/mcp-server/skills/datasets/
  SKILL.md                 the loop: list_available_datasets -> read a reference ->
                           load_available_dataset. Does NOT enumerate datasets.
  references/
    regional-sales.md      `description:` frontmatter + column table. A resource; on-demand context.
  assets/
    regional-sales.jsonl   the rows. Never a resource, never in context.
```

Adding a dataset = one file in each directory. `SKILL.md` never changes. Strict 1:1 pairing,
enforced by a test.

First dataset: expand the toy fixture (`cli.ts:12`'s five East/West/North Widget/Gadget rows, also
duplicated in `query.test.ts`) into a richer `regional-sales` sample — more rows and an added
`quarter` column, so it can support quarter-over-quarter questions — while keeping the familiar
shape. Its reference doc documents each column in the per-field style `summarizeDataset`
(`duckdb.ts:223`) already produces, and says loading happens through `load_available_dataset` rather
than by reading the asset.

### `packages/mcp-server/src/datasets.ts` (new)

Operates on the `Skill[]` `loadSkills()` already returns, reusing `skillsDirectory` and
`parseSkillFile`.

```ts
export function datasetsSkill(skills: Skill[]): Skill | undefined      // by DATASETS_SKILL_NAME
export function isValidDatasetName(name: string): boolean              // lowercase slug, safe filename
export function assetPathFor(name: string): string                     // skills/datasets/assets/<name>.jsonl
export function loadDatasetRows(name: string): Record<string, unknown>[]
export interface DatasetCatalogEntry { name: string; description: string; referenceUri: string }
export function buildCatalog(skill: Skill | undefined): DatasetCatalogEntry[]
```

`buildCatalog` lists `assets/*.jsonl` **by filename only**, pairs each with the already-loaded
`references/<name>.md` entry in `skill.references`, and pulls `description` via `parseSkillFile`.
It never opens an asset, so startup cost is independent of how large the proprietary data is. A
dataset missing its reference doc, its `description`, or its pairing throws naming the offending
file — a startup failure, not a silent omission from the catalog.

`load_available_dataset` is the only thing that reads rows, passing `loadDatasetRows`'s output
straight to the existing `loadDataset(rows, name)` (`duckdb.ts:134`), so no new ingestion path is
added.

## Part 3 — The `job-roles` skill and the prompt library

```
packages/mcp-server/skills/job-roles/
  SKILL.md                          what a role doc is and when to read one.
  references/
    chief-executive-officer.md      persona + that role's recommended prompts
    chief-financial-officer.md
    chief-revenue-officer.md
    chief-product-officer.md
    chief-operating-officer.md
```

Each doc's frontmatter carries `role` (the display name), `description` (what/when, same rule the
skill descriptions follow), and `prompts` — a list of `{ dataset, title, text }`. The body is the
persona: what this executive optimizes for, how they want an answer framed, what they do not care
about. That body is assistant-audience content the agent reads when the user is speaking as that
role; the prompt list is the human-facing library.

**Five roles against one five-column dataset is a real constraint**, so the shipped prompts stay
inside what `region`, `product`, `quarter`, `revenue` and `units` can answer — concentration and
quarter-over-quarter trend for the CEO, unit-volume mix for the COO — rather than reaching for
margin, pipeline or headcount the data does not have. A second dataset is the obvious way to
broaden the library later; the layout takes one without any code change.

### `packages/mcp-server/src/prompts.ts` (new)

```ts
export interface RolePrompt { role: string; roleSlug: string; dataset: string; title: string; text: string }
export function jobRoles(skills: Skill[]): Skill | undefined
export function buildPromptLibrary(skill: Skill | undefined): RolePrompt[]
export function promptNameFor(prompt: RolePrompt): string
/** Goes into each registration's `_meta`, and is what the picker groups on. */
export function promptMetaFor(prompt: RolePrompt): { kind: "recommended-prompt"; dataset: string; role: string; roleSlug: string }
```

`buildPromptLibrary` parses each role reference's frontmatter once at startup and flattens it into
`RolePrompt[]`. `promptNameFor` mints the MCP prompt name from role slug + dataset + a slug of the
title, following the **single-underscore style the existing `load_<skill>_skill` prompts already
use** (`cro_regional_sales_share_by_region`) — an earlier draft used `__` delimiters so the
grouping could be parsed back out of the name, which `_meta` makes unnecessary. Names must be
deterministic and collision-free: a duplicate is a startup error, since two prompts sharing a name
would silently overwrite one another in the registry. The `kind: "recommended-prompt"` marker
exists because `prompts/list` also returns the eight `load_<skill>_skill` prompts, and the picker
must show only library entries.

### `packages/mcp-server/src/server.ts` changes

- No change to skill or reference registration — both new skills and all their reference docs are
  picked up by the existing loop at `server.ts:54`/`:70`.
- `list_available_datasets` (`annotations: { readOnlyHint: true, idempotentHint: true }`, mirroring
  `list_chart_types`): returns the prebuilt catalog. Its description says these are *packaged*
  datasets available to load, that `referenceUri` carries the column detail, and that a `datasetId`
  comes from `load_available_dataset` — a catalog `name` is not an id.
- `load_available_dataset`: input `{ name: z.enum(datasetNames) }`, output identical in shape to
  `load_data` (`server.ts:101-134`), so `inspect_dataset`/`query`/`create_chart` need no changes.
  Memoize `name → datasetId` so picking the same dataset twice reuses the table rather than
  duplicating a large proprietary one in memory.
- **One `registerPrompt` per library entry**, alongside the existing per-skill prompts:
  `title` is the prompt's own title, `description` names the role and dataset in prose (that is
  what Claude Code shows), `_meta` is `promptMetaFor(prompt)`, and the callback returns a single
  user message carrying the prompt text. No `argsSchema` — these are fixed questions, not
  templates. Rendering the same prompt in Claude Code and in the web picker must produce the same
  text; the library is the one source.
- `INSTRUCTIONS`: add `list_available_datasets -> load_available_dataset` beside the `load_data`
  flow, and one line saying that if the user identifies as a role, the `job-roles` skill has that
  role's framing. The existing "read the relevant skill" line (`server.ts:40-42`) needs no change —
  two more skill URIs, not one per dataset or per prompt.
- `/health` (`server.ts:508`): add `datasets` (catalog names) and `prompts` (library prompt names).
  Both are lists, so the payload stays one kind of thing per field rather than mixing a list with a
  count.

### `packages/mcp-server/skills/data-analysis/SKILL.md`

Two small additions, both in existing sections. In "When you cannot answer" (line 114): before
asking the user for data, check `list_available_datasets` for a packaged dataset that covers the
question — the line that actually encodes "don't ask the user to hand over their own data", since
`load_data` is deliberately untouched. In "Before you chart" (line 46): `load_available_dataset`
returns the same per-field summary as `load_data`, so the same read-the-values discipline applies.

### `packages/mcp-server/src/skills.test.ts` (extended)

- Add `datasets` and `job-roles` to `EXPECTED` (`skills.test.ts:20`).
- A describe block driven off what is on disk, so new datasets and roles are checked without
  editing the test:
  - at least one dataset and one role exist;
  - strict 1:1 pairing between `datasets/assets/*.jsonl` and `datasets/references/*.md`, a failure
    naming the unpaired file;
  - each asset is non-empty, every line parses as JSON, all rows share one key set;
  - each dataset reference has frontmatter with a non-empty `description` that says when to use it
    (mirroring the `/\bUse (when|before|whenever)\b/i` check descriptions already face at
    `skills.test.ts:59`);
  - each role reference has `role`, a `description` under the same when-to-use rule, and at least
    one prompt with non-empty `title` and `text`;
  - **every `prompts[].dataset` names an existing dataset asset** — the integrity check that keeps
    the two skills from drifting apart;
  - `promptNameFor` produces unique, spec-legal names across the whole library.
- Export `isValidDatasetName` from `datasets.ts` and assert every dataset name passes it, so the
  scaffolder and the test share one rule.

### `packages/agent-server` changes

- `agent.ts`: `buildAgent()` already holds the MCP client in a local `client` (`agent.ts:46`)
  before discarding it — keep it on `AgentBundle` as `mcpClient`, typed against **narrow local
  interfaces** for the two calls the routes need, matching the discipline `skills.ts`'s
  `ResourceReader` already follows so the module takes no type dependency on the MCP SDK.
- `server.ts`: `GET /prompts` and `GET /datasets`, both with no model involved, exactly as
  `/health` uses `bundlePromise`. `/datasets` calls the `list_available_datasets` tool, falling back
  to text content when `structuredContent` is absent the way `cli.ts`'s `resultOf` already does.
  `/prompts` calls `listPrompts()`, keeps only entries whose `_meta.kind` is
  `"recommended-prompt"`, and groups them by `_meta.dataset` then `_meta.role` into the shape the
  picker renders. `listPrompts()` auto-paginates and returns an empty list if the server does not
  advertise the prompts capability, so no cursor handling and no special-casing an empty library.
- No change to `skills.ts`: `fetchSkills` already mirrors every reference resource into the
  deepagents virtual filesystem, so dataset docs and role docs arrive as
  `/skills/<skill>/references/<name>.md` and are read only when the agent asks. Asset rows are not
  resources, so they never travel.

### `packages/mcp-server/src/createDatasetSkill.ts` (new) — scaffolding CLI

`pnpm create-dataset <name> [--from <path>]`. Adds a dataset to the existing `datasets` skill; it
never creates a skill directory.

1. Validate `<name>` with the shared `isValidDatasetName`; refuse before writing anything.
2. Refuse if either `assets/<name>.jsonl` or `references/<name>.md` exists — a scaffolder, not a
   sync tool.
3. With `--from <path>`, read a `.json` array of row objects or a `.jsonl`; otherwise seed one
   placeholder row.
4. Write `assets/<name>.jsonl`.
5. Write `references/<name>.md` from a template that is **compliant on generation**, since
   verification runs `pnpm test` with the scaffolded dataset in place: `description:` frontmatter
   containing a literal "Use when …" alongside its `TODO` marker, and a column table
   auto-generated from the first row (name + `typeof`) so the author edits real column names. No
   link to the asset — the doc tells the agent to call `load_available_dataset`.
6. Print next steps: fill in the description and column notes, add prompts for it to whichever
   `job-roles` references should recommend it, `pnpm test`, restart `pnpm mcp`.

Scripts: `"create-dataset": "tsx src/createDatasetSkill.ts"` in
`packages/mcp-server/package.json`, plus a root passthrough matching the existing
`mcp`/`agent`/`web` pattern.

### `packages/web-client` changes

- `PromptPicker.tsx` (new): fetches `${AGENT_URL}${PROMPTS_PATH}` once on mount and renders the
  library grouped dataset → role → prompt title, disabled while `busy`, rendering nothing (not an
  error) when the library is empty. Its only prop is a callback receiving the chosen prompt's
  text; it holds no selection state and knows nothing about sending.
- `App.tsx`:
  - Drop the prefilled `EXAMPLE` (`App.tsx:26-29`); the composer starts empty.
  - The picker callback does `setDraft(text)` and focuses the textarea. Nothing else. Since the
    picker never sends, the existing inline `send` (`App.tsx:56-102`) gains no second caller, so
    **leave it as it is** — the `sendMessage` refactor an earlier draft called for would be churn.
  - Reframe the copy so the picker is the entry point and the composer is for questions: the
    empty-state hint (`App.tsx:112`) and the textarea placeholder (`App.tsx:146`) both stop saying
    "describe your data".

### `README.md`

- "the six Agent Skills" (README:8) becomes eight, and the skills table (README:110-118) gains
  `datasets` and `job-roles` rows.
- New **"Adding a dataset"** section: two files in `skills/datasets/` —
  `assets/<name>.jsonl` for rows, `references/<name>.md` for `description:` frontmatter and column
  notes — and `SKILL.md` is never touched. Fast path is `pnpm create-dataset <name> --from
  ./rows.json`. State why the split matters: `references/` is loaded into the agent's context,
  `assets/` is not, so rows never go in `references/`. Note that `pnpm test` enforces the pairing,
  and that an asset is read whole into memory when loaded, so keep them demo-sized.
- New **"Adding a job role or a recommended prompt"** section: one reference doc per role, its
  frontmatter carrying `role`/`description`/`prompts`, each prompt naming an existing dataset; the
  body is the persona the agent reads. Note that every prompt is registered as an MCP prompt, so
  `claude mcp add` (README:96) makes the library appear in Claude Code's own prompt picker — the
  clearest demonstration that the library is part of the product, not the client.
- Note that dataset assets are **committed and published** — `files: ["src", "skills"]` in
  `packages/mcp-server/package.json` includes them and nothing in `.gitignore` excludes them. Fine
  for the synthetic sample; worth saying out loud given the datasets are proprietary.
- Fix **"No file or URL ingestion"** (README:176), which currently reads "Inline rows only, which
  keeps the filesystem out of the picture" and stops being true. Restate: no *caller-supplied*
  file or URL ingestion — the only files read are the server's own bundled assets, chosen from a
  fixed enum, never a path from a tool argument.
- Rewrite the walkthrough (README:65-72) for the picker-first flow, mention the two new tools and
  `GET :3001/prompts`, and update the "93 tests" count (README:126).

## Files touched

**New**: `packages/{mcp-server,agent-server,web-client}/src/constants.ts`,
`packages/mcp-server/src/{datasets,prompts,createDatasetSkill}.ts`,
`packages/mcp-server/skills/datasets/{SKILL.md,references/regional-sales.md,assets/regional-sales.jsonl}`,
`packages/mcp-server/skills/job-roles/{SKILL.md,references/chief-*.md}` (five roles),
`packages/web-client/src/PromptPicker.tsx`.

**Modified**: `packages/mcp-server/src/{duckdb,query,chart,restyle,schemas,skills,server,cli,index,chart.test,skills.test}.ts`,
`packages/mcp-server/package.json`, root `package.json`,
**all nine skill Markdown files** (Part 0's rename, plus the `data-analysis` additions),
`packages/agent-server/src/{agent,model,skills,server}.ts`,
`packages/web-client/src/App.tsx`, `README.md`.

`vite.config.ts` is deliberately **not** modified — see Part 1. `packages/web-client` needs no
changes for Part 0; it is already camelCase.

## Landmines

Places where the obvious implementation breaks something that currently passes:

1. `vite.config.ts` importing anything that touches `import.meta.env` kills `pnpm web`.
2. Moving `MAX_RESULT_ROWS` / `ALLOWED_FRONTMATTER_FIELDS` / `SKILL_URI_PREFIX` breaks `index.ts`'s
   re-exports.
3. `skills.test.ts:137`'s "every skill referenced by another exists" check fails on any
   `the **hyphenated-token**` in a skill body that is not a real skill name — and both dataset
   names and role slugs are hyphenated, so never write `the **regional-sales**` or
   `the **chief-revenue-officer**` in prose.
4. The scaffolder's generated `description:` must contain "Use when", or `pnpm test` fails on a
   dataset the scaffolder itself just wrote.
5. Collapsing the three `10`s into one constant couples unrelated knobs.
6. Deriving `cli.ts`'s URL from the env-resolved `PORT` changes its behaviour.
7. Building the catalog or the prompt library per call re-reads every asset and role doc on every
   request.
8. `parseSkillFile` throws on a reference doc with no frontmatter — catch and re-raise naming the
   file, or a missing `---` block surfaces as an opaque startup crash.
9. Two library prompts slugging to the same MCP prompt name silently overwrite each other in the
   registry; `promptNameFor` collisions must fail at startup.
10. A prompt entry is `$strip` at the top level, so grouping metadata put anywhere other than
    inside `_meta` is silently dropped on the way to `prompts/list` — it will look like the data
    was never set rather than like a schema error.
11. `prompts/list` also returns the `load_<skill>_skill` prompts. Without the `_meta.kind` filter
    the picker would offer "load the chart-author skill" as a recommended executive prompt.
12. Renaming `semantic_types`/`theme_spec`/`chart_spec` at `chart.ts:150-163` breaks theming and
    semantic annotation **with no type error**, because that call is flint's snake_case API behind an
    `as Parameters<...>` cast. Charts still render, just wrong.
13. `agent-server/src/server.ts:46` reads `chart_type` with no camelCase fallback, unlike its
    neighbours — the chart-type label vanishes silently the moment the server emits `chartType`.
14. Nothing tests field names in skill Markdown, so a missed rename in a skill's JSON example
    surfaces as an agent authoring a rejected tool call at demo time, not as a failing test.

## Verification

1. `pnpm -r typecheck` and `pnpm -r test` — no credentials needed. The count rises above 93 (the
   per-skill loops fan out over two new skills and six new reference docs); update README to match.
   Typecheck is a weak signal for Part 0: it catches the `server.ts` handler renames but **not** the
   flint call at `chart.ts:150-163` (cast) or any field name in Markdown. Back it up with
   `grep -rn 'dataset_id\|chart_id\|chart_type\|vl_spec\|chart_spec\|semantic_types\|theme_spec\|row_count\|sample_rows\|preview_rows\|spec_without_data\|data_sample\|config_ui\|chart_types' packages README.md`
   and confirm every surviving hit is on the exclusion list — flint's call site, the alias values,
   tool names, and data columns.
2. `pnpm web` boots and serves — the specific regression Landmine 1 would cause.
3. `pnpm mcp`, then `pnpm --filter mcp-server cli`. This is the load-bearing check for Part 0: the
   CLI drives every tool end to end with no model, so a missed rename in `server.ts` or `cli.ts`
   fails here. Confirm the chart it builds is **themed and semantically annotated** — that is the
   only thing that catches the flint call site at `chart.ts:150-163`, and it fails by producing a
   plain-looking chart rather than by erroring. Also exercise a `configUI` restyle, since Part 0
   tightens that input from an unvalidated record to `ConfigControl`.
4. `curl -s :3000/health` lists `datasets` and `job-roles` under `skills`, `regional-sales` under
   `datasets`, and the library's prompt names under `prompts`.
5. Drive `list_available_datasets` → read `chart://skill/datasets/references/regional-sales.md` →
   `load_available_dataset({ name: "regional-sales" })` → `inspect_dataset` → `query` →
   `create_chart` via the MCP Inspector or a short script. Confirm `rowCount` matches the `.jsonl`
   line count, that `referenceUri` resolves as a resource, and that a second
   `load_available_dataset` returns the same `datasetId`.
6. `claude mcp add --transport http chart http://127.0.0.1:3000/mcp` (README:96), then confirm the
   executive prompts appear in Claude Code's prompt picker and that running one produces the same
   text the web picker inserts. This is the portability claim the whole demo rests on, so it is a
   required step, not a nice-to-have.
7. Full three-shell run (`pnpm mcp`, `pnpm agent`, `pnpm web`): `GET :3001/prompts` returns the
   library; the picker renders dataset → role → prompt; choosing one fills the composer without
   sending and the text is editable before Enter; Enter produces a chart with no data pasted into
   chat; "make the bars green" still restyles; and no UI copy prompts the user to paste rows. Watch
   the rendered chart for a **chart-type label**, which is what proves
   `agent-server/src/server.ts:46` was fixed rather than silently falling through.
8. `pnpm create-dataset demo-check --from <small .json array>`: writes `assets/demo-check.jsonl`
   and `references/demo-check.md`, **`pnpm test` passes with them in place** (this proves the
   template satisfies the pairing and summary checks), a second run is refused, and an invalid
   name is refused before anything is written. Then delete both files.
