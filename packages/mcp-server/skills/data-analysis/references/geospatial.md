# Questions about where

A geospatial question — "what's near what", "where do these cluster", "is this
concentrated somewhere" — runs through four steps that live in four different skills. The
chain is worth reading end to end before you start, because the third step is one most
people discover only after shipping a broken map.

## Does the question need coordinates at all?

Check the datasets' reference docs first. If both carry the same categorical geography — a
neighbourhood name, a supervisor district — then grouping each dataset by that key and
comparing the two results answers most "where" questions exactly, cheaply, and without a
map. Reach for coordinates when there is no shared key, or when the finding is about
distance or clustering rather than counts per area.

## The chain

**1. Load both datasets.** A spatial join names the second by its `datasetId`, so both
have to be loaded first.

**2. Join on proximity** — `query` with `spatialJoin`. See **data-query**'s
`references/spatial-join.md`. Two things to carry out of that step:

- Filter out placeholder coordinates (`0`, not null, in several datasets).
- If you plan to map the result, keep the coordinate columns in `groupBy` so they survive
  the aggregation. A result without coordinates cannot be mapped, and re-running the query
  to get them back is the most common wasted step here.

**3. Chart it** — `create_chart` with `chartType: "Map"`. See **chart-author**'s
`references/maps.md`.

**4. Zoom it** — and this is the step to plan for, not discover. A `Map` of anything
smaller than a country comes back as a dot on a national outline, and no chart property
fixes it. It takes a restyle that writes an explicit projection into the spec: see
**chart-restyle**'s `references/map-projections.md`. Budget the extra
`prepare_restyle`/`apply_restyle` round trip from the outset.

**5. Answer in prose.** One or two sentences, as always. The map shows where; your job is
what it means — which cluster, how concentrated, what is surprising about it. Don't
describe the map's axes or recite the recipe.

## Calibrating effort

A proximity join is a bigger commitment than a group-by, so match it to the question:

- **"Is there a food truck near the shoot at X?"** — one filtered query. No map needed.
- **"Where do shoots and trucks coincide?"** — the full chain above: join, map, zoom,
  answer.
- **"Does that hold across the city?"** — join once, then aggregate the joined result by
  neighbourhood. Often a bar chart answers it better than a second map.

## Reading the result honestly

Proximity is not causation, and a pair within 150 metres is not a relationship — both
things being downtown is usually explanation enough. Say what the geography shows and let
it be geography. Where density is doing the work, say so: the place with the most pairs is
frequently just the place with the most of everything.
