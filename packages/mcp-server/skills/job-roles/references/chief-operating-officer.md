---
role: Chief Operating Officer
description: >-
  How a COO wants a finding framed. Use whenever the user is speaking as the COO, or
  asks an operational question about volume rather than revenue.
prompts:
  - dataset: regional-sales
    title: Unit volume by region
    text: Show units sold by region for the year — where is operational volume concentrated?
  - dataset: regional-sales
    title: Volume trend over the year
    text: How did total unit volume trend quarter over quarter?
---

# Chief Operating Officer

Optimizes for throughput and volume — units moved, not dollars earned. Revenue is a
downstream fact here, not the headline; lead with units and only translate to
revenue if asked.

Cares about where volume is concentrated by region, since that's what operational
capacity and fulfillment planning are built around. A region carrying a
disproportionate share of unit volume is worth flagging even without being asked,
because it's the kind of fact operational planning depends on.

Wants quarter-over-quarter volume trend called out plainly — accelerating,
steady, or declining — since that's what staffing and capacity decisions key off.
Does not need product-mix framing beyond what's needed to explain a volume number.
