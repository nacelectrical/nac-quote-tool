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

## The equipment is drawn as one assembled arrangement

    RETURN PLENUM  →  FAN COIL  →  SUPPLY PLENUM

Three boxes bolted together, in that order, along one axis. The return plenum's
inner face IS the fan coil's return face and the supply plenum's inner face IS
its discharge face — no gap, no overlap, both centred on the unit, and 180°
apart by construction so they can never end up on the same side. The unit sits
square on the sheet: the axis comes from the mean bearing of the mains, snapped
to a quarter turn, because a fan coil drawn at 37° reads as a diamond.

The bodies are drawn at the size they are — about 1.25 m × 0.6 m for the fan
coil, scaled off the plan's own calibration — so the assembly does not swallow
the fittings beside it at whole-house zoom.

**Each duct has its own collar.** The supply plenum carries one Ø400 collar per
main (three on this job); the return plenum carries one Ø400 collar per return
duct (two). Runs are matched to collars by how far across the axis they leave,
so ducts never cross each other getting off the plenum. No supply run and no
return run shares a coordinate with any other.

**The supply plenum is a fabricated transition where it has to be.** Three Ø400
collars need 1320 mm of face; this unit's discharge flange is 1152 mm. So the
plenum is a 1152 mm throat on the flange, tapering out to a 1440 mm collar face
— and that one record is read by the drawing, the ductwork schedule, the BOM
line and the fabrication warning, so the sheet cannot contradict itself. It
still bolts flat to the discharge face; the throat IS that face.

**R1 and R2 are two ducts the whole way.** Each return runs from its own grille,
across on the grille's line to its OWN lane, then up that lane to its own collar
on the return plenum — 600 mm apart, which is what two Ø400 flexes side by side
in a hallway actually measure. They share no point of duct and there is no
junction between them. Squaring both onto the unit's centre line used to give
them a shared vertical leg, so one lay exactly on top of the other and every
metre of that leg was measured twice.

**A supply take-off is never set in the return corridor.** A BTO must stay
0.65 m clear of any return duct — the Ø400's radius, the half-width of a
fabricated take-off body, and a gap somebody can get a hand into. The keep-out
is routed by the same function that draws the returns, so it is the real
corridor rather than a guess: an earlier straight-line guess reported BTO-C2
comfortably clear of R2 while the duct that got drawn passed within 0.4 m of it.

Where a run's fitting sits behind the assembly — Main C's does, on this job — the
duct leaves its collar, steps clear of the metal and goes round the unit rather
than through it. The drawing tests check that no duct has a single point inside
the equipment bodies.

Return ductwork is dashed, in the return colour, with arrows showing the air
travelling toward the unit. Where a supply and a return route cross, the return
is broken with a gap and the supply bridges over it — never a junction dot,
because a dot is what a joint looks like.

The router gives every main and every return the fan coil's own centre as an
endpoint, which drawn literally made the return look plumbed into the supply.
The drawing re-anchors the last few pixels of each run to the collar it belongs
to. Lengths, pressure, airflow and the schedule are untouched by this — it is
the picture that was wrong, not the design.

## The BTO and the zone damper

A **BTO** is drawn as what it is: a compact sheet-metal body with square corners,
a white fill and a dark double-line outline, one inlet NECK (drawn wider) and one
outlet neck per actual port, each sitting on the face its duct leaves from and
pointing the way it goes. A neck is two parallel walls and a bead at the open
end, not a filled tile — a filled rectangle rotated to an arbitrary duct bearing
reads as a diamond, which is what the symbol was being mistaken for. Duct lines stop at the collar faces;
nothing runs through the body. The body scales with the inlet size and the
number of collars, so `BTO-C · 400-350-350` and `BTO-C2 · 350-250-250-250` are
visibly different pieces of metal. At normal whole-house zoom you can count the
collars; at full label detail each collar also carries its size, airflow and
zone.

A **zone damper** is an inline motorised damper: a short rectangular casing
sitting in the duct, at least 1.55× longer than the duct is wide — a casing as
long as it is wide is a square, and a square turned to follow a duct is a
diamond — its width taken from the duct diameter, one clean diagonal blade
inside the body, and the actuator box mounted on the side with a short shaft to
the spindle. It rotates to the duct's own tangent at the point it is fitted, so
it follows a swept run. A constant zone gets the same body labelled
`CONSTANT – LOCKED OPEN` and **no actuator**, because a motor drawn is a motor
ordered. A zone damper is never drawn on return ductwork.

## Minimum 2.0 m from a BTO collar to its outlet

`minimumBtoToOutletDuctLengthM = 2.0` in HVAC Design Settings. Every final duct
from a BTO collar to an outlet must have a **measured routed length** of at least
2.0 m on the calibrated plan. It is a layout rule, not a drawing offset: when a
fitting lands too close to an outlet the FITTING moves, and the ducts, pressure,
BOM and price are recalculated from where it ended up.

The move is constrained the way an installer is constrained — inside the
conditioned envelope, never into a bathroom, ensuite, laundry or garage, and far
enough off the supply plenum that the main is still a main — and among the
positions that satisfy all of that it takes the one with the smallest
size-weighted total of main plus finals. Runs are never padded to make the
number: a final is the same gentle bow it always was, measured honestly.

If no practical compliant position exists the design raises
`BTO_TO_OUTLET_CLEARANCE_REVIEW` as a CRITICAL warning, which blocks approval
until the installer confirms the fitting location.

Every symbol on every surface — the plan editor, Clean view, the internal report
and the PDF — is drawn by one shared library, `designer/ui/symbols.mjs`, so they
cannot visually disagree about what is being installed. Sizes are colour-coded
(ø400 magenta, ø350 purple-grey, ø300 green, ø250 amber, ø200 blue, return
dashed grey) AND labelled, because colour must never be the only cue on a
greyscale print.

**Text stays off the ductwork, and on its own side of the system.** A duct is a
line, not a rectangle: the bounding box of one diagonal run covers a quarter of
the house, so runs were never booked against label placement at all and
`BTO-C · 400-350-350` sat straight across the two return drops. Every run is now
stamped into an occupancy grid — supply and return kept apart — and a label pays
for the fraction of itself that lands on ink, three times over if it is the
other system's ink. Covering a symbol still costs more than covering a duct, and
distance only breaks ties, so the shortest genuinely clear leader wins.

**Where the two systems cross, the return hops over.** The gap is cut to the
width of the run passing THROUGH it, not the width of the run being broken, and
an arc in the return's own colour carries it across on a white casing. Two ducts
meeting at a point on a drawing means a joint, and a return joined to a supply
is the one thing this system must never look like.

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

Expected result for this handoff: 812 tests, 812 passed, 0 failed.

Browser suites live in `tools/browser-tests/`. `plan-view.mjs` covers the Plan
tab's view modes and `drawing-separation.mjs` proves supply and return are
drawn apart and that nothing on the sheet is written over anything else.
`symbols.mjs` is the visual regression for the symbol library — every symbol is
rendered to its own tile and checked for ink area, bounding box, corner fill and
mean colour, so a symbol that vanishes, collapses, explodes or stops being
distinguishable from another one is caught. It also reads the BTO, damper and
assembly GEOMETRY directly, because ink area cannot tell a manifold from a blob:
collar counts, collar bearings, inlet-versus-outlet widths, body scaling, the
actuator being mounted rather than floating, and a constant zone having no
actuator at all.

`tests/bto-clearance.test.mjs` is the engine side of the 2.0 m rule: every final
measured off the calibrated plan, no run padded, no fitting inside an outlet's
footprint, the topology and airflow unchanged, and the review warning raised
when no compliant position exists.

## The internal PDF

**The document carries its own font.** Declaring Helvetica leaves the reader to
find a face for it, and a reader with no Helvetica substitutes one, draws its
shapes and advances by the widths the file declares — which is where
`InternalHVAC Design Sheet` and `Totalaiflow` came from. The file was right and
the reader was guessing. Liberation Sans Regular and Bold (SIL OFL 1.1,
metric-compatible with Arial) now ship in `designer/vendor/fonts/` and go into
the PDF as `/FontFile2` with a `/FontDescriptor` and the real `/Widths`, so
there is no choice left to make. `tools/extract-font-metrics.mjs` reads the
widths straight out of the TTFs into `designer/ui/pdf-fonts.mjs`, and
`textWidth` measures with the face that will actually be drawn.

Two glyph defects went with it. The bullet, U+2022, had no WinAnsi entry, so
every bulleted list opened with `?`. And the middot — which is in every duct
label, every BTO spec and every page footer — was being *measured* at 556 units
when it is 278, because the Latin-1 shortcut ran before the table that knows the
real width. Every line carrying one had been laid out against a width that was
not its own.

**The plan page is a drawing on paper.** During a report capture the viewer
paints its background white instead of the app's dark chrome, and the capture is
trimmed to what was actually drawn. Embedded whole, the dark surround took about
a third of the landscape sheet and the drawing was scaled down to fit inside it.

**The drawing gets the paper; everything else gets a column.** A house plan
taller than it is wide is HEIGHT-bound on a landscape sheet, so widening the
picture does nothing — it is already far short of the width. The page heading,
the caption and the key therefore sit in a 200 pt column down the right-hand
side, where the sheet has width going spare, and the plan runs the full height
between the margins. The key is captured separately (`legendStrip()`) so it is
not baked into the same bitmap. Measured off the image placement matrix in the
file, on the Dungannon job that is **+27.7% linear, +63% area**.

**The trim keeps the drawing, not the builder's margins.** `inkBounds()` used to
take the first and last off-white pixel, which handed a fifth of the sheet to a
pale landscaping strip down one edge and the ghost of a title-block border down
the other. It now groups inked lines into runs, joins runs separated by less
than a clear gutter, and keeps the heaviest: the drawing is the big block of
ink, and anything across a white gutter from it is the sheet's own furniture.

**A heading wraps; it does not get cut off.** Clipped to its column the
ductwork schedule read `DIAMETE...`, `VELOCIT...` and `PRESSUR...` — headings
that no longer said what the numbers under them were.


Page 1 is the design summary and any CRITICAL warnings — the ones that block
approval are stated where the sheet opens, not on page seven. Page 2 is a
dedicated **landscape** floor-plan sheet: a house plan is wider than it is tall,
and on a portrait page the duct sizes stop being readable. Then an enlarged
equipment-area inset, cropped from the same Clean View drawing so the two can
never disagree, followed by the schedules and calculations.
