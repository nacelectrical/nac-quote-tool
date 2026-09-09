# NAC AI HVAC DESIGNER

An addition to the existing NAC quoting tool. Nothing was rebuilt: the designer
sits alongside the current pages, reuses the current equipment and price data,
and hands its result into the current quote pipeline.

```
FLOOR PLAN → PLAN INTERPRETATION → ROOM DIMENSIONS → LOAD CALCULATION
→ EQUIPMENT SELECTION → AIRFLOW DESIGN → OUTLET DESIGN → DUCT DESIGN
→ RETURN AIR → ZONING → MATERIALS → COSTING → CUSTOMER QUOTE
```

## The design rule

Deterministic engines do the engineering. AI only ever does two things:

1. **Reads the plan** (`/api/plan-read`) — returns observations: text it saw and
   where, plus wall/opening/label positions. It is forbidden from adding
   numbers together, computing areas, or deciding what a number means.
2. **Explains the design** (`/api/design-assistant`) — is handed the finished
   output of the engines and may only talk about those figures. It cannot
   change anything and cannot state a manufacturer spec that is not on file.

Every measurement carries a **source** and a **confidence score**, and a room
below the configured threshold cannot enter sizing without an explicit,
recorded estimator override.

## Why the plan reading is different

Builder plans do not label rooms "3.2 m × 3.5 m". They carry chained dimension
strings around the perimeter:

```
110 | 3600 | 90 | 1800 | 90 | 3200 | 90 | 3200 | 90 | 5640 | 110     (= 18020 overall)
```

`chains.mjs` reconstructs those into absolute coordinate stations:

```
0, 110, 3710, 3800, 5600, 5690, 8890, 8980, 12180, 12270, 17910, 18020
```

and checks the sum against the printed overall. `dimensions.mjs` then classifies
every number on the drawing — wall thickness, window width, door width, room
dimension, overall, setback, annotation — using nearby symbols, alignment and
chain membership. Room dimensions come from the spans between stations, which is
why **resizing or re-exporting the image cannot change a room dimension**.

### Measurement priority (never fabricated)

1. Verified architectural dimensions
2. Reconstructed architectural dimension chains
3. Dimension chain + wall geometry
4. Calibrated drawing geometry
5. Manual estimator input

## Scale

A printed `SCALE 1:100 @ A3` label is **supporting information only** — an
uploaded screenshot does not keep its original physical scale. The authoritative
scale is always the estimator's two-point **CALIBRATE PLAN** measurement, which
is stored with the design and can be redone at any time.

## Files

```
designer.html                     the app shell (NAC styling, iPad + desktop)
designer/app.mjs                  state, wiring, workflow
designer/ui/dom.mjs               small DOM helpers
designer/ui/plan-viewer.mjs       zoom/pan/pinch canvas: calibrate, rooms, routes, layout
designer/ui/tabs.mjs              the 13 design tabs
designer/ui/settings-screen.mjs   HVAC Design Settings
designer/ui/reports.mjs           internal + customer print sheets
designer/schema.sql               OPTIONAL nac_designs table (works without it)

designer/engines/                 deterministic engineering — no DOM, no AI
  units.mjs          millimetres internally, conversions at the edge
  settings.mjs       every configurable assumption in one place
  calibration.mjs    pixels ↔ millimetres, scale labels
  dimensions.mjs     classify every number on the plan
  chains.mjs         dimension chain reconstruction + closure
  rooms.mjs          measurement source, confidence, verification, NAC's
                     conditioned/excluded room rules
  interpret.mjs      glue: observations → chains → measured rooms
  loads.mjs          load calculation (extends the 145 W/m² rule)
  catalogue.mjs      the existing NAC ducted range + spec status
  equipment.mjs      ranked equipment selection
  airflow.mjs        airflow apportioned by calculated load
  outlets.mjs        outlet type and quantity
  ducts.mjs          duct sizing, velocity, pressure drop, route length
  returnair.mjs      return grille, filter, duct
  zones.mjs          zoning and minimum open airflow
  pressure.mjs       index-run static pressure estimate
  materials.mjs      material catalogue + price provenance
  bom.mjs            bill of materials
  costing.mjs        labour, cost, GP, GM — using NAC's existing sell price
  warnings.mjs       central validation, severity, acknowledgement
  model.mjs          data models + revisions
  pipeline.mjs       runs every stage
  store.mjs          Supabase + localStorage persistence
  sample-plan.mjs    the PART 36 realistic builder plan
  sample-plan-image.mjs  draws that plan so it can be worked on screen

api/plan-read.js        AI plan reader (observations only)
api/design-assistant.js NAC Design Assistant (grounded in the design)

tests/                  125 tests, run with `node --test tests/`
```

## Integration points

| Existing thing | How the designer uses it |
|---|---|
| `nac_settings` → `nac_brands_v4` | Read for model prices. Never written. |
| `nac_settings` → `nac_ctrl_v4` | Read for controller prices. Never written. |
| `nac_quotes` | The designer writes the same row shape `admin.html` writes, so `sign.html` renders it unchanged. |
| `sign.html` | Unchanged. Customers sign the same page. |
| `admin.html` | Gained a "1c. Load HVAC design" block next to the existing intake-draft loader. |
| `index.html` | Gained an "AI Designer" link in the header. |
| ServiceM8 / GHL | Untouched. |

New `nac_settings` keys the designer owns:
`nac_hvac_settings_v1`, `nac_hvac_materials_v1`, `nac_hvac_equipment_specs_v1`,
and `nac_design_<id>` when the optional `nac_designs` table is absent.

## Sizing: the 145 W/m² rule is preserved

`legacySizing()` reproduces NAC's existing rule exactly and its result is shown
on every design next to the detailed figure, with the variance. The detailed
engine splits the all-in 145 W/m² into a fabric base plus glazing, occupancy and
appliances; the defaults are calibrated so a typical project lands within a few
percent of the rule, and the sample project comes out at +7.6%.

## Prices

- **Sell price** is always NAC's existing installed price for the selected
  model. The designer never invents one — with no price configured it says so
  and refuses to quote.
- **Material rates** ship as clearly-labelled placeholders. Any design using one
  raises a CHECK warning naming the lines. Enter NAC's real rates in
  HVAC Design Settings → Material rates.
- **Manufacturer specs** (rated airflow, available static, dimensions,
  electrical, refrigerant) are never guessed. Missing ones report
  `SPECIFICATION DATA REQUIRED` and are excluded from the checks that need them.

## Running the tests

```bash
node --test tests/
```

No build step, no bundler, no package.json — the same deployment model as the
rest of the tool.

## Trying it

Open `/designer.html?sample=1` for the sample Australian builder plan: a
single-storey 4-bed + media project home with chained perimeter dimension rows,
wall thicknesses inside the chains, opening widths on their own row, and
annotations that look numeric but are not lengths. Every room dimension in it is
reconstructed, not read off a label.
