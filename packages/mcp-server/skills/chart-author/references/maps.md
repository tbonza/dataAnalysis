# Mapping coordinates

Two chart types put data on a map. Both need geography already in the rows — nothing here
geocodes an address.

| Chart type | Channels | Needs |
|---|---|---|
| `Map` | `longitude`, `latitude`, `color`, `size`, `opacity` | two numeric coordinate columns |
| `Choropleth` | `id`, `color`, `detail` | a column of state or country names/codes |

## `Map` — points at coordinates

```json
{
  "chartType": "Map",
  "encodings": {
    "longitude": "Longitude",
    "latitude": "Latitude",
    "size": "trucks_within_150m",
    "color": "trucks_within_150m"
  }
}
```

`longitude` and `latitude` are real geographic channels, not `x` and `y` — the projection
positions the marks. Getting the two the wrong way round puts your data in the Indian
Ocean, which is at least easy to spot.

**A city-scale map needs a restyle.** flint pins any US-bounded map to a whole-country
projection, so a single city renders as a dot. The chart properties that look like they
would fix this (`projection`, `projectionCenter`) are ignored at US scope, and are not a
zoom even where they apply. The fix is to write an explicit projection into the compiled
spec — read the **chart-restyle** skill's `references/map-projections.md` and plan on that
second step from the start. Don't ship the unzoomed chart and call it a map.

## `Choropleth` — filled regions

`id` carries the region key and `color` the value. Names ("California"), postal codes
("CA") and FIPS/ISO numbers all resolve. It only knows US states and world countries —
there is no built-in geography for neighbourhoods, districts, census tracts or postcodes,
so a question at that grain wants a `Map` of points, or a plain bar chart of the regions
by name.

## The fallback: a scatter of coordinates

A `Scatter Plot` with `x: longitude, y: latitude` needs no restyle and shows the shape of a
point cloud fine. It has no coastline, and one degree of longitude is shorter than one of
latitude away from the equator, so the picture is stretched — say so if it matters.

One trap: **leave the `Latitude`/`Longitude` semantic types off** for this. They pin the
axes to the full `[-180, 180]` and `[-90, 90]` range, which shrinks any real dataset to a
dot in the middle. They are right for a `Map`, wrong for a scatter standing in for one.

## Before you map anything

- Are the coordinate columns numeric, and are they longitude and latitude the way round
  you think?
- Does the dataset use `0` as a "no geocode" placeholder? Several do. Filter those rows
  out in the query, or they will drag the map to the Gulf of Guinea.
- Does the question actually need a map? "Which neighbourhood has the most" is a bar
  chart. A map earns its place when *where* is the finding — clustering, spread, a gap.
