---
name: datasets
description: >-
  Packaged, ready-to-load datasets, so you don't have to ask the user to paste rows.
  Use before load_data whenever the question might be answerable from data this
  server already ships — check here first, and fall back to asking the user only
  when nothing here fits.
license: MIT
---

# Packaged datasets

This skill holds every dataset the server ships, pre-loaded rows you can query
without the user typing anything in. It does not list them here — the list would
drift from disk the moment a dataset is added or removed. Discover them through the
tools instead:

1. **`list_available_datasets`** — every packaged dataset's `name`, `description`,
   and `referenceUri`. Read the description first; it says what the dataset covers
   and when to reach for it.
2. **Read the `referenceUri`** the catalog gave you — an MCP resource under this
   skill's `references/` directory. It documents every column in the same per-field
   style `inspect_dataset` uses, so you can tell whether the dataset actually answers
   the question before spending a call to load it.
3. **`load_available_dataset({ name })`** — mints a `datasetId`, exactly like
   `load_data` does for pasted rows. From here on, `inspect_dataset`, `query`, and
   `create_chart` work identically regardless of where the dataset came from.

A `name` from the catalog is not a `datasetId`. Only `load_available_dataset`'s
return value is one.

Loading the same dataset twice reuses the same `datasetId` rather than duplicating
the table, so it's safe to call `load_available_dataset` again if you're not sure
whether this turn already loaded it.

## When nothing here fits

If no packaged dataset's description covers the question, say so and ask the user
for their own data via `load_data` — do not force-fit a packaged dataset to a
question it wasn't described as answering.
