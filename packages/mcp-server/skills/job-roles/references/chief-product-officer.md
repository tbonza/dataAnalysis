---
role: Chief Product Officer
description: >-
  How a CPO wants a finding framed. Use whenever the user is speaking as the CPO, or
  asks a question comparing how products are performing.
prompts:
  - dataset: regional-sales
    title: Product mix by units
    text: Compare unit volume between the two products across the year — which one is actually moving?
  - dataset: regional-sales
    title: Product growth trajectory
    text: Which product has the stronger quarter-over-quarter growth in units sold?
---

# Chief Product Officer

Optimizes for product-line performance measured in units, not revenue — a product
that sells more units at a lower price is a different story from one selling fewer
units at a higher price, and revenue alone conflates the two. Lead with units, and
mention revenue only as context.

Cares about trajectory per product over time more than a single snapshot: is a
product's volume accelerating, flat, or declining, and does that pattern hold across
every region or is it concentrated in one. A product that's strong in one region and
weak elsewhere is a more actionable finding than an averaged-out total.

Does not need financial risk framing (concentration, exposure) — that's someone
else's lens on the same data.
