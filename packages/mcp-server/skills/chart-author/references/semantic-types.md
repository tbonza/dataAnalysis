# Semantic types

`semantic_types` maps a column to what it **means**. These are not Vega-Lite data
types — `quantitative`, `nominal`, `ordinal` and `temporal` are derived from these for
you. Annotating a field drives its number formatting, colour scheme, whether its axis
includes zero, tick behaviour, and sort order.

Annotate the fields you encode. Skip the rest, and pick the most specific type that
fits.

## The vocabulary

| Category | Types |
|---|---|
| Temporal instants | `DateTime`, `Date`, `Time`, `Timestamp` |
| Temporal granules | `Year`, `Quarter`, `Month`, `Week`, `Day`, `Hour`, `YearMonth`, `YearQuarter`, `YearWeek`, `Decade` |
| Duration | `Duration` |
| Monetary measures | `Amount`, `Price` |
| Physical measures | `Quantity`, `Temperature` |
| Proportion | `Percentage` |
| Signed / diverging | `Profit`, `PercentageChange`, `Sentiment`, `Correlation` |
| Generic measures | `Count`, `Number` |
| Discrete numeric | `Rank`, `Score` |
| Identifier | `ID` |
| Geographic | `Latitude`, `Longitude`, `Country`, `State`, `City`, `Region`, `Address`, `ZipCode` |
| Entity names | `Category`, `Name` |
| Coded categorical | `Status`, `Boolean`, `Direction` |
| Binned ranges | `Range` |
| Fallback | `Unknown` |

## Choosing between the near-misses

- **`Amount` vs `Price` vs `Profit`** — `Amount` for a summed monetary total,
  `Price` for a per-unit price, `Profit` for money that can be negative. `Profit` gets
  a diverging treatment around zero; `Amount` does not.
- **`Year` vs `Number`** — a column of `2020, 2021, 2022` is a `Year`. As a `Number`
  it is drawn as a measure, with an axis that may include zero and a decimal format.
- **`Percentage`** — check the values first. A column of `0.42` and a column of `42`
  both mean 42%, and tagging the wrong one scales it twice. If unsure, inspect the
  distinct values.
- **`Temperature` vs `Quantity`** — `Temperature` diverges around a meaningful point;
  `Quantity` does not.
- **`Count` vs `Quantity`** — `Count` for a tally of things, `Quantity` for a
  continuous measured amount.
- **`Rank`** — an ordinal position, where 1 is best. Drawn ascending, unlike a measure.
- **`ID`** — an identifier, never aggregated. Tag it so it doesn't get summed.
- **`Category` vs `Name`** — `Category` for a class an entity belongs to,
  `Name` for the entity itself. Cardinality usually decides it.
- **`Region`** — a geographic area name. Use `Category` for a non-geographic grouping
  that happens to be called "region" in the data.

## The annotation form

When the type name alone understates what you know, supply an object instead of a
string:

```json
{
  "rating":  { "semanticType": "Score", "intrinsicDomain": [1, 5] },
  "revenue": { "semanticType": "Amount", "unit": "USD" },
  "delta":   { "semanticType": "Profit", "divergingPivot": 0 }
}
```

| Field | Meaning |
|---|---|
| `semanticType` | Required. One of the names above. Note the camelCase. |
| `intrinsicDomain` | `[min, max]` for a bounded scale — a 1–5 rating, a 0–100 score. Only for genuinely bounded values, not open-ended measures. |
| `unit` | A unit or currency code: `USD`, `°C`, `kg`. |
| `divergingPivot` | The value a diverging colour scale should pivot on. A judgement, not a fact — declare it when the chart is *about* the comparison, and declaring one asserts the split even if every value lands on one side. |

## Worked annotations

```json
{ "month": "Month", "revenue": "Amount", "profit": "Profit", "region": "Region" }
```

```json
{ "country": "Country",
  "life_expectancy": { "semanticType": "Quantity", "unit": "years" },
  "gdp_per_capita":  { "semanticType": "Amount", "unit": "USD" } }
```

```json
{ "survey_date": "Date",
  "satisfaction": { "semanticType": "Score", "intrinsicDomain": [1, 10] },
  "nps_change":   "PercentageChange" }
```
