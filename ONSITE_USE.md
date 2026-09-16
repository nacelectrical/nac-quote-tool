# NAC quote tool — on-site use

The approved reference job is locked by regression tests to the requested
10-outlet, 3-main, 5-BTO topology.

## What the Plan tab shows

The Plan tab opens in **Clean view** — the approved installer drawing, with no
room boxes, no analysis labels and no editing handles. Three toggles beside it
put handles on that same drawing for the thing you are changing:

| Toggle | What it adds |
|---|---|
| **Clean view** | Nothing. The drawing as it is issued. |
| **Edit outlets/equipment** | Drag handles on the fan coil, supply plenum, return grilles and outlets. |
| **Edit routes/BTOs** | Handles on the BTO fittings, the run ends, and any point you added. |
| **Edit rooms** | The green room boxes and the analysis workings. Only this view shows them. |

## Supply and return are drawn as two separate systems

The fan coil has a SUPPLY PLENUM on its discharge side and a RETURN BOX on its
return side, a visible gap apart. Every supply main starts at the plenum; both
return ducts end at the box; the two never share an endpoint. Return ductwork is
dashed, in the return colour, with arrows showing the air travelling toward the
unit. Where a supply and a return route cross, the return is broken with a gap
and the supply bridges over it — never a junction dot, because a dot is what a
joint looks like.

The router gives every main and every return the fan coil's own centre as an
endpoint, which drawn literally made the return look plumbed into the supply.
The drawing re-anchors the last few pixels of each run to the box it belongs to.
Lengths, pressure, airflow and the schedule are untouched by this — it is the
picture that was wrong, not the design.

Every symbol on every surface — the plan editor, Clean view, the internal report
and the PDF — is drawn by one shared library, `designer/ui/symbols.mjs`, so they
cannot visually disagree about what is being installed. Sizes are colour-coded
(ø400 magenta, ø350 purple-grey, ø300 green, ø250 amber, ø200 blue, return
dashed grey) AND labelled, because colour must never be the only cue on a
greyscale print.

Route handles are the ones worth grabbing — the junctions (the BTOs), the ends,
and points a person added to get around an obstacle. The swept curve's own
tessellation points are not offered, because they are the shape of a bend rather
than anybody's decision.

## What can be adjusted on site

- Open the Plan tab and choose **Edit outlets/equipment** to drag the fan coil,
  supply plenum, return grilles and outlet positions.
- Choose **Edit routes/BTOs** to move a duct or BTO handle, add a route point,
  remove a point, or lock a route around real roof obstacles.
- Change an individual duct diameter in the Ductwork schedule.
- Change outlet quantity/type and return quantity/grille size in their tabs.
- Use Undo/Redo for route, layout and duct-size changes.

Dropping a moved item reruns the design once. Duct lengths, pressure, BOM,
costing and warnings update together; the engine is not rerun continuously
while a finger is moving on an iPad.

## Approved reference topology

- Main A: Ø400, 301 L/s → `400-250-250-250` BTO → Kitchen 113, Meals 67,
  one Family outlet 121.
- Main B: Ø400, 265 L/s → `400-300-250` BTO → Living 159, Former Lounge 106.
- Main C: Ø400, 233 L/s → `400-350-350` BTO. The main is a real measured run
  from the supply plenum out to BTO-C in the hallway/foyer circulation area,
  where the two Ø350 arms separate. A BTO never sits on the plenum.
  - Ø350, 95 L/s → `350-250-250` BTO → Foyer 45, Master 50.
  - Ø350, 138 L/s → `350-250-250-250` BTO → Bed 4 48, Bed 2 45, Bed 3 45.
- Return air: two 600 × 400 grilles in the bedroom hallway; each has its own
  Ø400 return duct to one fan-coil return box. There are no return BTOs.

New designs use the installer-area router by default. Existing saved designs
without that setting retain their prior routing. Placeholder material rates
block approval and customer quote/PDF output until replaced.

## Verification

Run from the project directory:

```sh
node --test tests/*.test.mjs
```

Expected result for this handoff: 787 tests, 787 passed, 0 failed.

Browser suites live in `tools/browser-tests/`. `plan-view.mjs` covers the Plan
tab's view modes and `drawing-separation.mjs` proves supply and return are
drawn apart and that nothing on the sheet is written over anything else.
`symbols.mjs` is the visual regression for the symbol library — every symbol is rendered to its own tile and checked for ink area,
bounding box, corner fill and mean colour, so a symbol that vanishes, collapses,
explodes or stops being distinguishable from another one is caught.
