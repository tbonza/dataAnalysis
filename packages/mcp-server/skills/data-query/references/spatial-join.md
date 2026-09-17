# Spatial join reference

`spatialJoin` is the one field in a query spec that reaches a second dataset. It pairs
rows whose coordinates are close on the ground, and it is the only join the `query` tool
does — there is no equi-join on a shared key.

## Shape

```json
{
  "spatialJoin": {
    "datasetId": "ds-abc123",
    "lonColumn": "Longitude",
    "latColumn": "Latitude",
    "otherLonColumn": "Longitude",
    "otherLatColumn": "Latitude",
    "withinMeters": 150
  }
}
```

- `datasetId` — the other **already-loaded** dataset. Load it first; an id that isn't
  loaded is rejected with the ids that are.
- `lonColumn` / `latColumn` — the coordinate columns on *this* dataset.
- `otherLonColumn` / `otherLatColumn` — the coordinate columns on the other one.
- `withinMeters` — the radius. A true circle on the ground, not a degree box.

All four column names are checked before anything runs, and a wrong one is rejected with
the columns that do exist.

## What the join produces

Three things join the column set, and from that point they behave like ordinary columns —
`select`, `where`, `groupBy`, `aggregate`, `orderBy` and `compute` all work on them:

| Column | What it is |
|---|---|
| every column of this dataset | unchanged |
| `other_<name>` | every column of the other dataset, prefixed |
| `distance_meters` | how far apart the pair is, great-circle metres |

So the other dataset's `Applicant` arrives as `other_Applicant`. If a prefixed name would
collide with a column already here, the join is refused rather than silently shadowing
one — narrow the columns with a query first, then join that result.

## Worked example

Film locations with a permitted food truck within 150 metres, and how close the nearest
one is:

```json
{
  "spatialJoin": {
    "datasetId": "<mobile-food-permits id>",
    "lonColumn": "Longitude", "latColumn": "Latitude",
    "otherLonColumn": "Longitude", "otherLatColumn": "Latitude",
    "withinMeters": 150
  },
  "where": [{ "column": "other_Latitude", "operator": "!=", "value": 0 }],
  "groupBy": ["Title", "Longitude", "Latitude"],
  "aggregate": [
    { "op": "min", "column": "distance_meters", "as": "nearest_truck_m" },
    { "op": "count_distinct", "column": "other_Applicant", "as": "trucks_within_150m" }
  ],
  "orderBy": [{ "column": "trucks_within_150m", "direction": "desc" }]
}
```

Keeping `Longitude` and `Latitude` in the `groupBy` is deliberate: it carries the
coordinates through to the result so the answer can be mapped. See the **chart-author**
skill's `references/maps.md`.

## Three things that will bite you

**Placeholder coordinates.** A dataset with no geocode for a row often stores `0`, not
null — a point off the coast of Africa that silently pairs with nothing useful. Filter
them out (`{"column": "other_Latitude", "operator": "!=", "value": 0}`) and check the
dataset's reference doc, which says whether it has them.

**Self-joins pair every row with itself.** Passing this dataset's own id finds clusters
within it ("which locations sit within 100m of another?"), but every row matches itself at
`distance_meters` 0, and every real pair appears twice, once from each side. Filter with
`{"column": "distance_meters", "operator": ">", "value": 0}`.

**Size is capped.** A proximity join has no index behind it, so the work is
`rows x other rows`. Past 50 million pair comparisons it is refused, naming both row
counts. That is not a dead end: filter or aggregate one side with an ordinary query
first, then spatial-join the result, which is usually what you wanted anyway.

## When it is the wrong tool

If both datasets carry the same categorical key — a neighbourhood name, a district
number — grouping each one separately and comparing is cheaper, exact, and easier to read
than a proximity join. Reach for `spatialJoin` when there is no shared key, only
coordinates.
