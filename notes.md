# Data Visualization Notes

--------------------------------------------------------------------------------

# Data Formulator: Chart Generation Notes

## LLM-Driven Chart Generation Flow

### Overview
The `data-formulator` project uses a combination of LLM-driven reasoning and heuristic-based rules to generate charts from user prompts. Below is the end-to-end flow for creating a chart.

---

### Step-by-Step Flow

#### 1. **User Input**
- The user provides a prompt (e.g., "Show sales by region as a bar chart") in the encoding shelf or chat UI.
- **Key Files**:
  - `src/views/EncodingShelfCard.tsx`
  - `src/views/SimpleChartRecBox.tsx`

---

#### 2. **Intent Classification**
- The `intentClassifier.ts` module determines whether the prompt should trigger:
  - **`'style'`**: Fast restyle of an existing chart (handled by `CHART_RESTYLE` endpoint).
  - **`'data'`**: Full LLM-driven chart generation (handled by `ANALYST_STREAMING` endpoint).
- **Key File**: `src/app/intentClassifier.ts`

---

#### 3. **LLM Streaming (Data Agent)**
- If classified as `'data'`, the `SimpleChartRecBox.tsx` component streams responses from the `/api/agent/analyst-streaming` endpoint.
- The LLM returns a `refinedGoal` object, which includes:
  - `chart_type`: The recommended chart type (e.g., `"bar"`).
  - `encodings`: Field mappings (e.g., `{ x: "region", y: "sales" }`).
  - `config`: Additional chart settings (e.g., `{ show_values: true }`).
- **Key File**: `src/views/SimpleChartRecBox.tsx` (lines 1128–1257)

---

#### 4. **Chart Resolution**
- The `resolveRecommendedChart` function maps the LLM’s `refinedGoal` to a concrete `Chart` object:
  - Translates `chart_type` to a display name (e.g., `"bar"` → `"Bar Chart"`).
  - Populates the `encodingMap` with field IDs from the `encodings` object.
- **Key File**: `src/app/chartRecommendation.ts`

---

#### 5. **Heuristic Fallback**
- If the `refinedGoal` does not specify encodings, the `vlRecommendEncodings` function (from `flint-chart`) provides default recommendations based on:
  - Data types (e.g., quantitative, categorical).
  - Semantic types (e.g., `"category"`, `"measure"`).
- **Key File**: `flint-chart/packages/flint-js/src/vegalite/recommendation.ts`

---

#### 6. **Chart Creation**
- The `createNewChart` reducer in `dfSlice.tsx` finalizes the `Chart` object and:
  - Adds it to the Redux store.
  - Focuses the chart in the UI.
- **Key File**: `src/app/dfSlice.tsx` (lines 1184–1207)

---

#### 7. **Rendering**
- The `Chart` object is passed to `react-vega` or `vega-lite` for rendering.
- **Key File**: `src/views/ChartView.tsx`

---

### Mermaid.js Diagram
```mermaid
flowchart TD
    A[User Input
(e.g., 'Bar chart of sales by region')] --> B[Intent Classification
(intentClassifier.ts)]
    B -->|'data'| C[Stream LLM Response
(ANALYST_STREAMING endpoint)]
    B -->|'style'| G[Fast Restyle Agent
(CHART_RESTYLE endpoint)]
    C -->|refinedGoal| D[Resolve Chart
(chartRecommendation.ts)]
    D --> E{Is refinedGoal
valid?}
    E -->|Yes| F[Create Chart
(dfSlice.tsx)]
    E -->|No| H[Fallback to Heuristics
(vlRecommendEncodings)]
    H --> F
    F --> I[Render Chart
(react-vega/Vega-Lite)]
    G --> I
```

---

### Key Dependencies
| Component          | Dependencies                                                                 |
|--------------------|------------------------------------------------------------------------------|
| **LLM Integration**| Backend API (`/api/agent/analyst-streaming`), no direct SDK in frontend.     |
| **Charting**       | `vega-lite`, `react-vega`, `flint-chart`.                                    |
| **Heuristics**     | `flint-chart` (rule-based encoding recommendations).                         |

---

### Key Takeaways
1. **LLM Precedence**: The LLM’s `refinedGoal` drives the majority of chart creation. Heuristics act as a fallback for ambiguous or incomplete prompts.
2. **Separation of Concerns**:
   - `data-formulator`: Handles UI, LLM communication, and state management.
   - `flint-chart`: Provides deterministic encoding rules for chart types.
3. **Critical Path**: For LLM-driven charts, steps **2 → 3 → 4 → 6** are mandatory.

--------------------------------------------------------------------------------

# Flint-Chart: Heuristic-Based Encoding Recommendations

## Overview
`flint-chart` provides **deterministic, rule-based encoding recommendations** for charts. These heuristics act as a fallback when the LLM (in `data-formulator`) does not specify encodings or for non-LLM workflows.

---

## Core Logic
The `vlRecommendEncodings` function recommends encodings (e.g., `{ x: "field1", y: "field2" }`) based on:
1. **Chart Type**: Target type (e.g., `"bar"`, `"line"`).
2. **Data Types**: Quantitative (`number`), categorical (`string`), temporal (`date`).
3. **Semantic Types**: Column roles (e.g., `"category"`, `"measure"`).
4. **Cardinality**: Number of unique values (e.g., low-cardinality fields for `color`).

---

## Key Rules by Chart Family

| Chart Family          | Semantic Roles                     | Example Rules                                                                 |
|-----------------------|-------------------------------------|-------------------------------------------------------------------------------|
| **XY Standard**       | `x: category`, `y: measure`         | Bar Chart: `x` → first categorical, `y` → first quantitative.               |
| **XY Horizontal**     | `y: category`, `x: measure`         | Horizontal Bar Chart: Same as XY Standard but axes swapped.                 |
| **Pie**               | `color: category`, `size: measure`  | Pie Chart: `color` → categorical, `size` → quantitative.                     |
| **Line/Scatter**      | `x: temporal`, `y: measure`         | Line Chart: Prefers temporal `x`; falls back to categorical if no temporal. |
| **Map**               | `latitude: geo`, `longitude: geo`   | Geo Map: Picks first geo fields for `latitude`/`longitude`.                  |

---

## Example Heuristic Snippet (`vlRecommendEncodings`)
```typescript
// From: flint-chart/packages/flint-js/src/vegalite/recommendation.ts
function vlGetRecommendation(chartType: string, tv: InternalTableView): Record<string, string> {
    const rec: Record<string, string> = {};
    
    switch (chartType) {
        case 'Bar Chart':
            assign('x', pickDiscrete(tv, used));
            assign('y', pickQuantitative(tv, used));
            break;
        case 'Pie Chart':
            assign('color', pickDiscrete(tv, used));
            assign('size', pickQuantitative(tv, used));
            break;
        // ... other chart types
    }
    
    return rec;
}
```

---

## Integration with Data Formulator
- **Fallback Role**: Used when `refinedGoal` lacks encodings.
- **Validation**: Ensures LLM-provided encodings are valid for the chart type.
- **Flexibility**: Rules can be customized to support new chart types.

---

### Key Files
| File                                      | Purpose                                                                                     |
|-------------------------------------------|---------------------------------------------------------------------------------------------|
| `flint-chart/packages/flint-js/src/vegalite/recommendation.ts` | Main heuristic logic for `vlRecommendEncodings`.                          |
| `flint-chart/packages/flint-js/src/core/recommendation.ts`     | Defines chart families and semantic roles (e.g., `FAMILY_XY_STANDARD`). |
| `flint-chart/packages/flint-js/src/core/semantic-types.ts`    | Infer semantic types (e.g., `isQuantitative`, `isCategorical`).          |