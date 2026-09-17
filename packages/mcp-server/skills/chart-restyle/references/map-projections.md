# Zooming a map to a city

A `Map` chart drawn at city scale comes back useless: every point lands in a cluster a
pixel or two across, somewhere on an outline of the whole United States. Fixing it is a
restyle, and it is the only way to fix it.

## Why `create_chart` can't do this

flint picks the map's geography from the data. Points inside the US bounding box make it a
US map, and a US map is pinned to the `albersUsa` projection — a fixed projection of the
whole nation. The `projection` and `projectionCenter` chart properties exist, but they are
gated to world-scope maps and are ignored here, silently. Even on a world map they only
choose a projection family and a rotation from a list of continent presets; neither is a
zoom.

Vega-Lite then sizes the view to fit everything drawn, and what is drawn includes the
entire US states outline. A city is a rounding error inside that, so it renders as a dot.

There is no `scale`, `extent` or bounding-box option anywhere in the template. The zoom has
to be written into the compiled spec, which is what this skill is for.

## The recipe

After `create_chart` gives you a `Map`, and `prepare_restyle` gives you its spec:

Set `projection` on **every** layer — the basemap and the points both, or they will not
line up:

```json
{
  "type": "mercator",
  "center": [-122.44, 37.765],
  "scale": 260000
}
```

- `center` is `[longitude, latitude]` — the middle of your data, not of the country.
- `scale` sets the zoom. An explicit `scale` is the part that matters: it replaces
  Vega-Lite's fit-to-everything behaviour, which is what was pulling the view out to the
  whole nation.

A square `width`/`height` (say 640 x 640) suits a city, which is roughly as tall as it is
wide; the default 500 x 300 crops it.

Then `apply_restyle` as usual.

## Picking `scale`

`scale` is roughly pixels per radian, so the span you want to see sets it:

```
scale ≈ canvas_width_px / longitude_span_in_radians
```

| To frame | Try |
|---|---|
| a city (~0.15° across) | 250,000 – 280,000 |
| a few neighbourhoods | 600,000+ |
| a metro area / county | 80,000 – 120,000 |
| a state | 8,000 – 15,000 |

Start from the table, look at the result, adjust. Too small and the points huddle in the
middle; too large and they spill off the edges.

## What the basemap gives you at this zoom

The underlying geography is a coarse US **states** outline, so zoomed to a city you get
the coastline and land edge — real orientation, but no streets, districts or landmarks.
That is usually enough to read a point cloud as a place. If it isn't, say so rather than
implying the map shows more detail than it does.

## Check it worked

Read the projection back off the restyled spec: it should be your `mercator` block, and
the compiled output should no longer contain a `fit`. If the points still cluster, the
projection went onto only one layer, or `scale` is missing.
