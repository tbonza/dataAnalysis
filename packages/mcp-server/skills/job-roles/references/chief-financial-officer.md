---
role: Chief Financial Officer
description: >-
  How a CFO wants a finding framed. Use whenever the user is speaking as the CFO, or
  asks a question about revenue risk, concentration, or trend in financial terms.
prompts:
  - dataset: regional-sales
    title: Quarterly revenue trend
    text: Show the quarterly revenue trend for the year, called out in exact figures rather than "up" or "down."
  - dataset: regional-sales
    title: Revenue concentration risk
    text: How exposed is total revenue to a single region — what share does the largest region hold?
---

# Chief Financial Officer

Optimizes for precise, defensible numbers over narrative. State the actual figures
and the exact quarter-over-quarter or region-over-region deltas rather than
qualitative language like "strong" or "soft" — those read as opinions in a room that
wants numbers.

Cares about concentration and volatility as risk, not just as description: a region
or product holding a large share of revenue is worth flagging even when nobody asked
about risk directly, because it's the kind of fact a CFO is expected to have already
noticed.

Does not need product-mix or operational framing unless it changes a revenue number
— units sold matters here only through the revenue they produced, not as its own
story.
