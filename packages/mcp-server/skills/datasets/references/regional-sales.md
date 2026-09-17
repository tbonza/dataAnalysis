---
description: >-
  Quarterly unit sales by region and product for a two-product line. Use when a
  question is about regional concentration, product mix, or a quarter-over-quarter
  trend and no other dataset has been loaded yet.
---

# regional-sales

32 rows: 4 regions × 2 products × 4 quarters of one fiscal year. Load it with
`load_available_dataset({ name: "regional-sales" })` — this file documents the shape
so you can decide whether it fits the question before spending a call; it is not
itself a source of rows, and the asset behind it is never read directly.

## Fields

- `region` -- type: VARCHAR, distinct: 4, values: East, North, South, West
- `product` -- type: VARCHAR, distinct: 2, values: Gadget, Widget
- `quarter` -- type: VARCHAR, distinct: 4, values: Q1, Q2, Q3, Q4
- `revenue` -- type: DOUBLE, range: 2700 – 13608
- `units` -- type: BIGINT, range: 180 – 1639

## What it can answer

Regional concentration ("which region drives the most revenue"), product mix within
a region, and quarter-over-quarter trend within a region or product — `quarter` is
ordered Q1..Q4 but carries no year, so trend means within-year seasonality, not
year-over-year growth. There is no cost, margin, headcount, or pipeline column, so a
question that needs one of those is out of scope for this dataset.

## Joining with other datasets

Does not join with `film-locations`, `mobile-food-permits`, or `registered-businesses` —
`region` here is an abstract label (East/North/South/West), not a San Francisco
neighborhood or supervisor district, and there is no other shared key. Treat this as a
standalone dataset.
