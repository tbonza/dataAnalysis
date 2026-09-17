# Chart MCP demo

An MCP tool for data analysis and charting, plus a reference agent and chat client that
consume it.

The **MCP server is the product**. It has no model of its own: a consuming agent
authors query and chart specs, and the server executes, validates and compiles them.
Everything an agent needs to know is in the tool schemas and the eight **Agent Skills**
the server exposes as MCP resources — so any team's existing agent can use it without
inheriting anything from the agent in this repo. Two of those skills, `datasets` and
`job-roles`, document a catalog of ready-to-query tables and an executive prompt library
so a user can pick a question instead of pasting rows into chat — see
[Adding a dataset](#adding-a-dataset) below.

Built on [flint-chart](https://github.com/microsoft/flint-chart) for chart compilation
and DuckDB, via the native [`@duckdb/node-api`](https://duckdb.org/docs/current/clients/node_neo/overview)
client, for data, with the analyst behaviour adapted from
[data-formulator](https://github.com/microsoft/data-formulator).

```
packages/mcp-server     the product — DuckDB + flint + skills. No LLM, no credentials.
packages/agent-server   a deep agent whose only capability is the MCP tool.
packages/web-client     chat UI that renders the returned specs inline.
packages/demo           runs all three behind one port, for proxied environments.
```

## Quickstart

```bash
nvm use                              # Node 24, per .nvmrc
pnpm install
tar -xzf <data-archive>.tar.gz       # the cache and the prebuilt database
pnpm demo                            # → http://127.0.0.1:8080
```

That is the whole setup. Only `pnpm demo` needs AWS credentials; every other path here —
the MCP server, the CLI walkthrough, the full test suite — runs without them.

## Requirements

- **Node 24+.** `.nvmrc` pins it and every package's `engines` field requires it, so
  `nvm use` in this directory is the one setup step that's easy to skip. `.npmrc` sets
  `engine-strict=true`, which turns a wrong version into a loud failure rather than a
  half-working install:

  ```
  ERR_PNPM_UNSUPPORTED_ENGINE  Unsupported environment (bad pnpm and/or Node.js version)
  ```

  If `pnpm` is missing entirely (`pnpm: command not found`), nvm isn't loaded in that
  shell — run `nvm use`, then `corepack enable pnpm` if it's still absent. A system Node
  on `PATH` will shadow nvm's in any shell that doesn't source it, which is the usual
  cause.
- **pnpm 10** — `packageManager` pins 10.29.2, and corepack installs it for you.
- **AWS credentials with Bedrock access** — only for the agent server. The MCP server
  and its whole test suite run without them.
- **The data archive** — see below. No dataset is committed to this repo.

## Getting the data

A skill is read into an agent's context, so no parquet file lives in one — and none is
committed anywhere else either. Data reaches a machine through one archive, which
carries both halves:

```
.cache/example-data/<group>/…          source data, one subdirectory per origin
packages/mcp-server/data/catalog.db    the prebuilt DuckDB database
```

```bash
tar -xzf <data-archive>.tar.gz         # from the repo root
```

**Only the database is needed to run anything.** The MCP server ATTACHes it read-only at
startup and never opens a parquet file, so a machine that has `catalog.db` and no cache
at all works fine. The cache is what `pnpm build-catalog` reads when you want to
*rebuild* that database — adding a dataset, or picking up changed source data. It's a
rebuild step, not part of setup, and running it with no cache present is a no-op that
leaves the existing database alone.

To produce an archive from a machine that has both:

```bash
tar -czf <data-archive>.tar.gz .cache/example-data packages/mcp-server/data
```

Both paths are gitignored, as is the whole of `.cache/`. Anything under `.cache/` outside
`example-data/` is ignored by the build — `.cache/raw/` is a convenient place to keep
original downloads whose filenames don't match dataset names, so they don't get picked up
as datasets in their own right.

## Run the MCP server on its own

This is the interesting path: the full tool surface works with **no model and no
credentials**.

```bash
pnpm mcp        # http://127.0.0.1:3000/mcp
```

`pnpm mcp` refuses to start without `packages/mcp-server/data/catalog.db` — unpack the
data archive, or run `pnpm build-catalog` to build one. Packaged datasets are prebuilt
offline into a DuckDB database the server opens read-only at startup; it never reads a
parquet file itself. See [Getting the data](#getting-the-data).

In a second shell, drive it end to end:

```bash
pnpm --filter mcp-server cli
```

That walks `load_data` → `query` → `create_chart` → `prepare_restyle` /
`apply_restyle` → `create_report`, printing the generated SQL, the compiled Vega-Lite
spec, and the repairable errors a consuming agent relies on. `curl -s
http://127.0.0.1:3000/health` lists the loaded skills, the packaged datasets, and the
executive prompt library's names.

There is also a packaged-data path, so a caller never has to type rows in:
`list_available_datasets` returns whatever the catalog database holds, and
`load_available_dataset({ name })` mints a `datasetId` exactly like `load_data` does.
From there `inspect_dataset` → `query` → `create_chart` work identically regardless of
where the data came from. See [Adding a dataset](#adding-a-dataset) to put something new
into the catalog.

To look at a spec without running the client, `pnpm preview-chart <spec.json> [out.html]`
writes a self-contained HTML page you can just open. It's a local development aid, no
part of the MCP surface.

## Run the whole demo

Three shells, in order.

```bash
pnpm mcp      # 1. the MCP tool          → :3000
pnpm agent    # 2. the deep agent        → :3001   (needs AWS credentials)
pnpm web      # 3. the chat client       → :5173
```

Open <http://127.0.0.1:5173>. The first screen names the packaged data that's ready,
and you start as the **Chief Executive Officer** — shown on a chip above the composer,
which is also the only way into the left flyout.

Click the chip and a picker scopes the panel to one role, with that role's one-line
brief and its suggested questions written out in full. The picker filters as you type,
and matches anywhere in the name, so `fin` finds the Chief Financial Officer where a
plain dropdown would need you to get past "Chief". Enter takes the highlighted match.
Click a question and its text fills the composer, editable — nothing sends until you
press Enter or Send. Type your own question instead if you prefer.

Whatever the chip shows is sent with the message, so the agent frames its answer the
way that executive wants it — a CFO gets the margin read, a CEO gets the one-sentence
version. Pick *Anyone* in the picker, or clear the chip with `×`, to go back to an
unframed answer. Either way you get a chart with no data pasted into chat, and a
follow-up like *"make the bars green"* exercises the restyle path. The agent's tool
calls fold into one collapsed *N steps* line per turn — open it to see each call and
its arguments; text and charts stay inline. A rendered chart carries a **Download PNG**
button once it has drawn, and a generated report summary a **Copy** button, so you can
get either out of the page without resorting to a screenshot. The flyout is served by `GET
:3001/prompts`, which groups the MCP server's prompt library by dataset then role;
`GET :3001/datasets` proxies the catalog the same way.

If the agent server reports an expired token, refresh your credentials (e.g. `aws sso
login`) **and restart the agent server** — it resolves credentials once at startup, so a
running process keeps using the stale ones. `curl -s http://127.0.0.1:3001/health` shows
which tools and skills it picked up from the MCP server.

## Run `pnpm demo` behind one port

Three ports don't survive a network proxy that only exposes one address. `pnpm demo`
puts everything behind a single port instead — one shell, no CORS:

```bash
pnpm demo     # → http://127.0.0.1:8080
```

It builds the chat client, starts the MCP and agent servers on loopback, waits for both
to report healthy, and serves the built client from its own small server
(`packages/demo/src/server.ts`) proxying the rest:

| Path | Goes to |
|---|---|
| `/` | the built chat client |
| `/api/*` | the agent server (`/api/chat`, `/api/prompts`, `/api/datasets`, `/api/health`) |
| `/mcp` | the MCP server |

The client is built with `VITE_AGENT_URL=api` and Vite's `base` set to `./`, so both its
API calls and its own JS and CSS are **document-relative** — nothing is resolved against
the origin root, and there is no absolute `http://127.0.0.1:3001` baked in to be
unreachable from wherever you're browsing. That is what lets a proxy mount the demo under
a path prefix (see below). Only the one port listens externally; :3000 and :3001 stay
bound to loopback. Ctrl-C stops all three.

The front door is ours rather than Vite's preview server, because a proxied deployment
needs things preview does not promise: a stream that is never buffered or compressed on
its way through, a real 404 for a missing asset instead of `index.html` under the wrong
content type, and a `Host` allow-list whose rules are written down here. `pnpm web` still
uses Vite's dev server; only `pnpm demo` is served this way.

To reach it through a proxy, name the hostname you'll use — the demo rejects a `Host`
header it doesn't recognise, and so do the MCP server's DNS-rebinding guards:

```bash
pnpm demo --allowed-host my-proxy.internal
```

Repeat `--allowed-host`, or hand it a comma-separated list, for more than one. A proxy on
this machine — a SageMaker notebook's `/proxy/8080/`, say — needs nothing further, since
the one port is still reached over loopback, and the client's relative URLs land inside
the prefix on their own:

```bash
pnpm demo --allowed-host d-xxxxxxxx.studio.us-east-1.sagemaker.aws
```

Reaching the demo from a *different* machine additionally means binding something other
than loopback:

```bash
pnpm demo --host 0.0.0.0 --allowed-host my-proxy.internal
```

`claude mcp add --transport http chart http://my-proxy.internal:8080/mcp` then works
through the same address — under a path-prefixing proxy, give it the prefixed URL
(`https://…/proxy/8080/mcp`). Naming a host widens the allow-lists rather than disabling
them: an unlisted `Host` or `Origin` still gets a 403.

One caveat for a path prefix: open it **with the trailing slash** — `/proxy/8080/`, not
`/proxy/8080`. Relative URLs resolve against the directory of the current document, so
without it the browser looks one level too high and every asset 404s (a blank page, and a
console complaining that the CSS came back as `text/html`). jupyter-server-proxy and
SageMaker redirect to add the slash; a hand-typed or hand-built link may not.

`pnpm demo` is for constrained environments, not for development — it serves a
production build, so there's no hot reload. Keep using the three-shell setup above
while editing the client.

To drive the agent without the browser, `POST /chat` and read the SSE stream. Reuse a
`threadId` across turns — that is what lets a follow-up restyle find the previous turn's
chart. `role` is optional and does what the chip does in the browser; send it on every
turn you want framed, since the server keeps no role of its own:

```bash
curl -sN -X POST http://127.0.0.1:3001/chat -H 'content-type: application/json' \
  -d '{"message":"East 200 revenue, West 250, North 90. Chart revenue by region.","threadId":"t1","role":"Chief Financial Officer"}'

curl -sN -X POST http://127.0.0.1:3001/chat -H 'content-type: application/json' \
  -d '{"message":"Make the bars green.","threadId":"t1"}'
```

A `role` must be a display name the prompt library defines — `GET /prompts` lists them,
and `"Chief Financial Officer"` is one where `"CFO"` is not. Anything else is dropped and
the turn streams unframed, so a request never fails over a role the server doesn't know.

Events are `{type: "text" | "tool" | "chart" | "report" | "error" | "done"}`; a `chart`
event carries the `vlSpec` to render. A `text` event with `delta: true` is one chunk of a
message still being written — append it to the last one rather than showing it as its own
block. Prose streams token by token, so a turn reads as it is generated; tool calls and
charts arrive a graph step at a time as before. History is in memory, so it resets when
the process does.

The stream is written to survive an intermediary: headers are flushed before the first
event, `no-transform` and `x-accel-buffering: no` ask proxies not to buffer or compress
it, a comment frame of padding goes out first for proxies that only flush past a byte
threshold, and a heartbeat keeps a long turn from hitting an idle timeout. Comment frames
carry no `data:` line, so a client ignores them. If you see a turn arrive all at once
through a proxy, that is the thing to look at.

## Point your own agent at it

This is what the demo is for. The server speaks streamable HTTP at
`http://127.0.0.1:3000/mcp`. For Claude Code:

```bash
claude mcp add --transport http chart http://127.0.0.1:3000/mcp
```

Then tell your agent to read `chart://skill/data-analysis` and go. It needs nothing
from `packages/agent-server` — if it did, the skills would be incomplete. The
executive prompt library travels the same way: every recommended prompt is a real MCP
prompt, so it shows up in Claude Code's own prompt picker — the clearest
demonstration that the library is part of the product, not the `packages/web-client`
UI.

DNS-rebinding guards are armed, so requests must come from a localhost origin.

## The skills

Skills live in `packages/mcp-server/skills/` and are served as resources under
`chart://skill/<name>`, each with a matching prompt. Detail sits in `references/`
subdirectories, exposed as their own resources, so an agent loads it only when needed.

| Skill | Covers |
|---|---|
| `data-analysis` | The loop: inspect before charting, how many charts a question deserves, when to stop |
| `data-query` | The QuerySpec grammar — and what it deliberately cannot do |
| `chart-author` | Picking a chart type, mapping channels, semantic types |
| `chart-restyle` | Appearance-only edits, and the follow-up control contract |
| `theme-author` | Presets and brand overrides for a consistent look |
| `report` | Assembling prose and existing charts into one document |
| `datasets` | The packaged-dataset catalog: how to list, read, and load one |
| `job-roles` | Executive personas an answer can be framed for, and their recommended prompts |

They follow the [Agent Skills specification](https://agentskills.io/specification), and
a test enforces it: name matching its directory, no frontmatter fields outside the
permitted set, bodies under 500 lines, and every relative link resolving.

## Adding a dataset

The `datasets` skill holds prose only — one `references/<name>.md` per table. The data
lives in the cache, and the catalog database is what the server actually reads. Adding a
dataset means putting a file in the cache and rebuilding.

### 1. Put the file in a cache group

```
.cache/example-data/<group>/<name>.parquet     # or <name>.csv
```

Groups (`sf-open-data/`, `mock-sales-data/`, …) organise the cache by where the data came
from. They don't namespace the dataset, so the same name in two groups is refused; add a
new group directory whenever a new origin deserves one.

**The filename stem becomes the dataset name**, and it has to be a valid slug —
`^[a-z0-9]+(-[a-z0-9]+)*$`, 64 characters or fewer. Rename the file rather than fighting
this later: `registered-businesses.parquet`, not
`Registered_Business_Locations_-_San_Francisco_20260916.parquet`.

CSV is fine. `pnpm build-catalog` converts any `.csv` that has no parquet beside it yet,
in place, scanning the whole file for type inference rather than sampling a few rows — a
sampled guess risks a type mismatch partway through a large file. Already-converted files
are skipped, so re-running costs nothing. (`pnpm csv-to-parquet <in-dir> <out-dir>` does
the same conversion standalone if you'd rather do it as its own step.)

### 2. Build

```bash
pnpm build-catalog
```

Rebuilds `packages/mcp-server/data/catalog.db` from scratch from everything in the cache,
and scaffolds `references/<name>.md` for any dataset that doesn't have one yet.

### 3. Write the reference doc

A scaffolded doc arrives full of `TODO`s, and `build-catalog` says so at the end if any
remain. This file **is** loaded into an agent's context, as an MCP resource — the parquet
behind it never is — so it's the only thing telling an agent whether the dataset answers
a question. Fill in:

- **`description:` frontmatter** — what it covers and when to reach for it. It must
  contain "Use when" (or "Use before" / "Use whenever"); a test enforces that, because a
  description that doesn't say *when* is useless at selection time.
- **the preamble** — provenance in a line, any caveats, and the
  `load_available_dataset({ name: "<name>" })` call.
- **`## What it can answer`** — including what it *can't*, which is what stops an agent
  force-fitting it to the wrong question.
- **`## Joining with other datasets`** — name each sibling and say whether it joins.
- **`## Source`** — upstream link, portal or dataset ID, maintaining agency, how any
  derived column was produced, and the update cadence.

Leave **`## Fields`** alone. It's generated from the live schema in the same style
`inspect_dataset` uses at runtime, so the two can't drift; every rebuild rewrites that
one section and preserves the rest byte-for-byte, so hand-written prose survives.
`references/mobile-food-permits.md` is the fullest model to copy.

### 4. Check it

```bash
pnpm test
```

The suite enforces a 1:1 pairing between catalog tables and `references/*.md` in both
directions, so a dataset with no doc — or a doc whose table you've since dropped from the
cache — fails here rather than at demo time. The server refuses to start on the same
mismatch.

Then repack the archive (see [Getting the data](#getting-the-data)) so other machines get
both the new source file and the rebuilt database. The catalog database is a build
artifact, never hand-edited, and the live server only ever ATTACHes it read-only.

## Adding a job role or a recommended prompt

Roles live under `packages/mcp-server/skills/job-roles/references/`, one file per
role. Frontmatter carries `role` (display name), `description` (when to use it), and
`prompts` — a list of `{ dataset, title, text }`, each naming a dataset that actually
exists. The Markdown body is the persona: what that executive optimizes for and how
they want an answer framed — content the agent reads when the user is speaking as
that role, distinct from the prompt list, which is what the picker renders.

`pnpm test` checks the whole library: every prompt's dataset resolves to a real one,
every reference has the required frontmatter, and every prompt mints a unique MCP
prompt name.

## Tests and checks

```bash
pnpm test            # 195 tests across four packages' suites; needs no credentials
pnpm typecheck       # all four packages
```

The mcp-server suite ATTACHes the catalog database, so
`packages/mcp-server/data/catalog.db` has to exist — unpack the data archive first, or
run `pnpm build-catalog`. No part of the suite needs AWS credentials.

The suite covers query compilation and validation, the DuckDB round trip, chart-type
resolution and flint assembly, the `configUI` sanitizer's prototype-pollution guards,
skill compliance, and the dataset/job-role library's own integrity (table↔reference
pairing, prompt-name uniqueness, every prompt's dataset actually existing). A few tests
are security regressions: `read_csv_auto('/etc/hosts')` and `ATTACH`ing a database file
outside the engine's `allowed_directories` are both refused.

The agent server's own suite covers the one thing the browser can't show you without AWS
credentials: how a `role` is handled. It checks that the name is trimmed and that
newlines and over-long values are refused, that the allow-list is built from the prompt
library's own role names, and that an unrecognised role produces an unframed answer
rather than an error.

## Configuration

| Variable | Default | Used by |
|---|---|---|
| `PORT` | `3000` | mcp-server |
| `MCP_URL` | `http://127.0.0.1:3000/mcp` | cli, agent-server |
| `AGENT_PORT` | `3001` | agent-server |
| `CLIENT_ORIGIN` | `http://127.0.0.1:5173` | agent-server (CORS) |
| `VITE_AGENT_URL` | `http://127.0.0.1:3001` | web-client |
| `BEDROCK_MODEL_ID` | `us.anthropic.claude-sonnet-5` | agent-server |
| `AWS_REGION` | `AWS_DEFAULT_REGION`, then `us-east-1` | agent-server |
| `MCP_ALLOWED_HOSTS` | localhost only | mcp-server (DNS-rebinding guard) |
| `MCP_ALLOWED_ORIGINS` | localhost only | mcp-server (DNS-rebinding guard) |
| `DATA_CACHE_DIR` | `.cache/example-data` | `pnpm build-catalog` only — the live server never reads the cache |
| `DATASET_CATALOG_DB_PATH` | `packages/mcp-server/data/catalog.db` | mcp-server, `pnpm build-catalog` |
| `DEMO_HOST` | `127.0.0.1` | demo — what the one port binds (`--host`) |
| `DEMO_PORT` | `8080` | demo (`--port`) |
| `DEMO_ALLOWED_HOSTS` | *(unset)* | demo — hostnames allowed to reach it, comma-separated (`--allowed-host`) |
| `DEMO_MCP_PORT` | `3000` | demo — loopback port for the MCP child |
| `DEMO_AGENT_PORT` | `3001` | demo — loopback port for the agent child |
| `DEMO_SKIP_BUILD` | *(unset)* | demo — reuse the existing `dist/` |

The three `DEMO_` settings with a flag beside them take it on `pnpm demo`'s command line,
and the flag wins over the variable — a proxy's hostname belongs to the machine you happen
to be on, not to a file under version control.

Credentials come from the default AWS provider chain — environment, SSO, profile, or
instance role.

`MCP_ALLOWED_HOSTS` / `MCP_ALLOWED_ORIGINS` add to the localhost defaults rather than
replacing them, so the DNS-rebinding guards stay armed for everything not named.
`pnpm demo` passes its allowed hosts — `--allowed-host` or `DEMO_ALLOWED_HOSTS` — through
to both.

## Troubleshooting

| Symptom | Cause |
|---|---|
| `pnpm: command not found` | nvm isn't loaded in this shell. `nvm use`, then `corepack enable pnpm` if it's still missing. A system Node on `PATH` shadows nvm's in any shell that doesn't source it — that's the usual reason. |
| `ERR_PNPM_UNSUPPORTED_ENGINE` on install | Node is older than 24. `nvm use` (`.nvmrc` pins it). `.npmrc` sets `engine-strict=true`, so this fails outright instead of half-working. |
| `No catalog database at …`, MCP server exits 1 | Unpack the data archive, or run `pnpm build-catalog`. Under `pnpm demo` it surfaces as *"The MCP server exited unexpectedly (1)"* a second or two in. |
| `pnpm build-catalog` prints "Nothing to build" | The cache is empty or absent. That's a no-op by design, and your existing database is left exactly as it was. |
| Startup looked fine; the first message fails | AWS credentials. They resolve lazily, so `/health` returns 200 without them and the demo still prints *"Demo ready"* — the failure only appears in the browser. Refresh them (e.g. `aws sso login`) **and restart the agent server**, which resolves credentials once at startup. |
| `pnpm demo` serves a blank page, assets 404 | Either `DEMO_SKIP_BUILD` is set with no `packages/web-client/dist/` to reuse — nothing checks for this, so it starts and 404s quietly — or you opened a proxy path without its trailing slash. |
| `Port 3000 is already in use` | Something is still bound from a previous run; `pnpm demo` checks both child ports before starting anything. |
| A reference doc has no matching table, or vice versa | The cache and the database disagree. `pnpm build-catalog` to re-sync, or delete the stale doc. Both `pnpm test` and server startup refuse the mismatch. |

## How it works, and what it will not do

**Data.** Rows are loaded inline and become a queryable dataset, or a packaged dataset's
already-built table is attached in read-only. Transforms are declared as a structured
`QuerySpec` — filter, group, aggregate, one arithmetic step, sort, limit — which is
compiled to SQL with [mosaic-sql](https://idl.uw.edu/mosaic/api/sql/). Every result
registers as a new dataset, so multi-step work is a chain of queries.

Accepting no SQL text is a security property, not just ergonomics: a query cannot name
a table function, so `read_csv_auto('/etc/passwd')` is unreachable by construction.
That matters because `@duckdb/node-api` is a native binding with real filesystem
access, unlike the sandboxed Node shim a WASM build would have — so DuckDB's own
`enable_external_access=false`, plus a narrow `allowed_directories` allowlist (only the
ephemeral ingest scratch directory and the catalog database's own directory, both
server-decided at startup), is set as well. That is defense in depth on top of the
primary guarantee above: no path this engine ever opens comes from a request — the
catalog database's path is fixed at startup, not chosen by a request.

**Charts.** flint-chart compiles a semantic chart spec into Vega-Lite, making layout,
colour and formatting decisions from the semantic types. Neither server renders: they
return JSON and the client rasterizes, which is what lets the same spec become a PNG, an
SVG, or a slide.

**Deliberately absent:**

- **No code execution.** Upstream's analyst writes Python in a sandbox; this replaces
  that with the query grammar. Clustering, forecasting and custom statistics are
  therefore unsupported, and the `data-query` skill says so rather than letting an agent
  discover it.
- **No joins on a shared key.** One dataset per query; chaining covers multi-step
  aggregation. The one exception is `spatialJoin`, which pairs rows from two datasets
  by coordinate proximity rather than a common column — see the `data-query` skill.
- **No caller-supplied file or URL ingestion.** `load_data` takes inline rows only. The
  packaged-dataset tools never read a caller-supplied path, or even a raw parquet file
  at request time — `load_available_dataset`'s `name` is a closed enum built from the
  catalog database `pnpm build-catalog` produced before the server started, so the
  tables a request can reach are fixed at startup, not chosen by the request.
- **Nothing persists — for session data.** Pasted rows and query-chain results live in
  memory and die with the process. Packaged datasets are the one exception by design:
  they're prebuilt once, offline, into a read-only database file so the server never
  has to touch parquet itself; `pnpm build-catalog` rebuilds it whenever the source
  files change.
