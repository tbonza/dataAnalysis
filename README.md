# Chart MCP demo

An MCP tool for data analysis and charting, plus a reference agent and chat client that
consume it.

The **MCP server is the product**. It has no model of its own: a consuming agent
authors query and chart specs, and the server executes, validates and compiles them.
Everything an agent needs to know is in the tool schemas and the eight **Agent Skills**
the server exposes as MCP resources — so any team's existing agent can use it without
inheriting anything from the agent in this repo. Two of those skills, `datasets` and
`job-roles`, package proprietary-looking sample data and an executive prompt library
so a user can pick a question instead of pasting rows into chat — see
[Adding a dataset](#adding-a-dataset) below.

Built on [flint-chart](https://github.com/microsoft/flint-chart) for chart compilation
and [DuckDB-WASM](https://github.com/duckdb/duckdb-wasm) for data, with the analyst
behaviour adapted from
[data-formulator](https://github.com/microsoft/data-formulator).

```
packages/mcp-server     the product — DuckDB + flint + skills. No LLM, no credentials.
packages/agent-server   a deep agent whose only capability is the MCP tool.
packages/web-client     chat UI that renders the returned specs inline.
packages/demo           runs all three behind one port, for proxied environments.
```

## Requirements

- **Node 20+** (developed on 26) and **pnpm 10** (`packageManager` pins 10.29.2)
- **AWS credentials with Bedrock access** — only for the agent server. The MCP server
  and its whole test suite run without them.

## Install

```bash
pnpm install
```

## Run the MCP server on its own

This is the interesting path: the full tool surface works with **no model and no
credentials**.

```bash
pnpm mcp        # http://127.0.0.1:3000/mcp
```

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
`list_available_datasets` returns the catalog (today, one dataset — `regional-sales`),
and `load_available_dataset({ name })` mints a `datasetId` exactly like `load_data`
does. From there `inspect_dataset` → `query` → `create_chart` work identically
regardless of where the data came from.

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
its arguments; text and charts stay inline. The flyout is served by `GET
:3001/prompts`, which groups the MCP server's prompt library by dataset then role;
`GET :3001/datasets` proxies the catalog the same way.

If the agent server reports an expired token, refresh your credentials (e.g. `aws sso
login`) **and restart the agent server** — it resolves credentials once at startup, so a
running process keeps using the stale ones. `curl -s http://127.0.0.1:3001/health` shows
which tools and skills it picked up from the MCP server.

## Run it behind one port

Three ports don't survive a network proxy that only exposes one address. `pnpm demo`
puts everything behind a single port instead — one shell, no CORS:

```bash
pnpm demo     # → http://127.0.0.1:8080
```

It builds the chat client, starts the MCP and agent servers on loopback, waits for both
to report healthy, and serves the built client with Vite's preview server proxying the
rest:

| Path | Goes to |
|---|---|
| `/` | the built chat client |
| `/api/*` | the agent server (`/api/chat`, `/api/prompts`, `/api/datasets`, `/api/health`) |
| `/mcp` | the MCP server |

The client is built with `VITE_AGENT_URL=/api`, so its calls are relative and
same-origin — there is no absolute `http://127.0.0.1:3001` baked in to be unreachable
from wherever you're browsing. Only the one port listens externally; :3000 and :3001
stay bound to loopback. Ctrl-C stops all three.

To reach it through a proxy, name the hostname you'll use — Vite rejects a `Host` header
it doesn't recognise, and so do the MCP server's DNS-rebinding guards:

```bash
pnpm demo --allowed-host my-proxy.internal
```

Repeat `--allowed-host`, or hand it a comma-separated list, for more than one. A proxy on
this machine — a SageMaker notebook's `/proxy/8080/`, say — needs nothing further, since
the one port is still reached over loopback:

```bash
pnpm demo --allowed-host d-xxxxxxxx.studio.us-east-1.sagemaker.aws
```

Reaching the demo from a *different* machine additionally means binding something other
than loopback:

```bash
pnpm demo --host 0.0.0.0 --allowed-host my-proxy.internal
```

`claude mcp add --transport http chart http://my-proxy.internal:8080/mcp` then works
through the same address. Naming a host widens the allow-lists rather than disabling
them: an unlisted `Host` or `Origin` still gets a 403.

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
event carries the `vlSpec` to render. History is in memory, so it resets when the process
does.

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

A packaged dataset is two files under `packages/mcp-server/skills/datasets/` —
`SKILL.md` is never touched:

- `assets/<name>.jsonl` — the rows, one JSON object per line. Never loaded into an
  agent's context; only `load_available_dataset` reads it.
- `references/<name>.md` — `description:` frontmatter (what the dataset covers and
  when to reach for it) plus a column-by-column doc in the same style
  `inspect_dataset` uses. This file *is* loaded into context, as an MCP resource —
  which is exactly why rows never belong in it.

Fast path:

```bash
pnpm create-dataset <name> --from ./rows.json   # a JSON array of row objects, or a .jsonl
```

It refuses to overwrite an existing dataset or write an invalid name, and its
generated `references/<name>.md` is spec-compliant on write — `pnpm test` enforces
the 1:1 pairing between `assets/` and `references/`, so a mismatched or malformed
dataset fails the suite immediately rather than at demo time. An asset is read whole
into memory when loaded, so keep them demo-sized.

Dataset assets are **committed and published** — `packages/mcp-server/package.json`'s
`files` list includes `skills/`, and nothing in `.gitignore` excludes the `assets/`
subdirectory. Fine for the synthetic sample shipped here; worth knowing if you're
adding anything genuinely proprietary.

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
pnpm test        # 133 tests across two suites; needs no credentials
pnpm typecheck   # all four packages
```

The suite covers query compilation and validation, the DuckDB round trip, chart-type
resolution and flint assembly, the `configUI` sanitizer's prototype-pollution guards,
skill compliance, and the dataset/job-role library's own integrity (asset↔reference
pairing, prompt-name uniqueness, every prompt's dataset actually existing). One test
is a security regression: it asserts that `read_csv_auto('/etc/hosts')` is refused.

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
| `AWS_REGION` | `us-east-1` | agent-server |
| `MCP_ALLOWED_HOSTS` | localhost only | mcp-server (DNS-rebinding guard) |
| `MCP_ALLOWED_ORIGINS` | localhost only | mcp-server (DNS-rebinding guard) |
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

## How it works, and what it will not do

**Data.** Rows are loaded inline and become a queryable dataset. Transforms are
declared as a structured `QuerySpec` — filter, group, aggregate, one arithmetic step,
sort, limit — which is compiled to SQL with
[mosaic-sql](https://idl.uw.edu/mosaic/api/sql/). Every result registers as a new
dataset, so multi-step work is a chain of queries.

Accepting no SQL text is a security property, not just ergonomics: a query cannot name
a table function, so `read_csv_auto('/etc/passwd')` is unreachable by construction.
That matters because the WASM sandbox does **not** contain filesystem access — this
build's Node runtime implements file opens with `fs.openSync` — so DuckDB's own
`enable_external_access=false` is set as well.

**Charts.** flint-chart compiles a semantic chart spec into Vega-Lite, making layout,
colour and formatting decisions from the semantic types. Neither server renders: they
return JSON and the client rasterizes, which is what lets the same spec become a PNG, an
SVG, or a slide.

**Deliberately absent:**

- **No code execution.** Upstream's analyst writes Python in a sandbox; this replaces
  that with the query grammar. Clustering, forecasting and custom statistics are
  therefore unsupported, and the `data-query` skill says so rather than letting an agent
  discover it.
- **No joins.** One dataset per query; chaining covers multi-step aggregation.
- **No caller-supplied file or URL ingestion.** `load_data` takes inline rows only. The
  packaged-dataset tools do read from disk, but never from a caller-supplied path —
  `load_available_dataset`'s `name` is a closed enum built from the assets that ship
  with the server, so the files a request can reach are fixed at startup, not chosen
  by the request.
- **Nothing persists.** Datasets and charts live in memory and die with the process.
