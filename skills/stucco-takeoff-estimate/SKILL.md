---
name: stucco-takeoff-estimate
description: Stucco and EIFS takeoff from architectural PDF plan sets, priced into an M3 Construction Services estimate PDF in Marco's format. Use this whenever Marco (M3, DFW stucco contractor) uploads plans, elevations, a plan-set zip or a builder's drawing set and wants the stucco found, measured, square-footed, bid, quoted, priced or estimated, even if he only says "price this", "what's the stucco on this house" or "find the stucco". Also use it for EIFS bands on commercial sets, for a takeoff review PDF or ProTakeoff project file, and for updating the stucco rate card. It covers scanning the set, measuring by hatch detection or wall-face takeoff, high work above 12 ft, foam trim counts, rate cards and the estimate document.
---

# Stucco takeoff and estimate

You are doing what a stucco estimator does: find every stucco surface on a plan set,
measure it net of openings, split out work above 12 ft, count the trim, price it from
M3's rate card, and hand Marco a client-ready estimate plus the evidence (shaded
sheets) that lets him check the numbers before he sends it. Marco reviews every number;
your job is to make the review fast and the quantities defensible.

## Deliverables, every time

1. The estimate PDF in M3's format: `M3_Estimate_<Client>_<Scope>.pdf` (scope STC for stucco, EIF for EIFS).
2. A takeoff review PDF: the elevation sheets with every counted area shaded, plus a summary page.
3. The job file (JSON) behind the estimate, so prices and quantities can be changed and rebuilt.
4. Optionally a ProTakeoff project (`.takeoff`) that opens in Marco's app with the regions drawn.
5. A short report: areas per elevation, what was and was not counted, every price that is a
   placeholder he must confirm, and anything on the drawings that changes the scope.

## Setup

```bash
pip install -r scripts/requirements.txt       # pymupdf, shapely, reportlab, Pillow
cd scripts                                    # scripts import each other from here
```
Everything is Python 3.10+. Work in a fresh folder per job; copy the plans into it.

## Workflow

### 1. Inventory the set

```bash
python3 scan_sheets.py plans.pdf --dots
```
Find the elevation sheets (exterior elevations, usually one per side, sometimes four to a
sheet for a garage or guest house), the scale (1/4" = 1'-0" means 18 points per foot,
1/8" means 9), and the finish callouts. Read the cover sheet's general notes and the wall
sections for the specified system (coats, lath, WRB/sheathing) and note anything that
differs from M3's three-coat system. Look at page thumbnails: render pages with pymupdf
and view them. Building program square footages on the cover give you a sanity check later.

### 2. Pick the measuring method

- **Hatch method** when the stucco walls carry a sand/stipple hatch. `scan_sheets.py --dots`
  shows hundreds to thousands of dots on each elevation page. Use `hatch_regions.py`.
- **Wall-face method** when walls are drawn plain with a "STUCCO" leader (dots per
  elevation near zero, or only a logo's worth). Use `sheet_levels.py`, `wall_faces.py`,
  `wall_takeoff.py`.

Dots on plan or section pages are usually concrete or gravel hatch, not stucco. A title
block logo can carry 100,000 dots; the hatch detector drops those automatically.

### 3A. Hatch method

```bash
python3 hatch_regions.py plans.pdf --page 8 --out out/A3 \
    --zone "Front elevation:220,860,2170,1590" --zone "Right elevation:320,30,2110,810" \
    --exclude 1655,340,2050,705          # a crossed-out room, if any
python3 high_work.py out/A3.json out/A4.json --floor "Front elevation:1560" ... --out out/takeoff-items.json
python3 regions_to_takeoff.py --name "Job stucco" --out job.takeoff "A3:sheet-a3.pdf:out/A3.json" ...
```
Zones are display-point boxes around each elevation (read them off a thumbnail); every
region is labeled by the zone its centroid falls in. `--floor` is each elevation's first
finish floor y; everything above it minus 12 ft is high work. Open `<out>-overlay.png`
and check every region against the drawing: green regions are whole faces, orange ones
were clipped to their dots. Stone, brick and roof hatches are not dots and are never picked
up; an unhatched stucco wall is also not picked up, so add any you see by hand.

### 3B. Wall-face method

```bash
python3 sheet_levels.py plans.pdf --page 8            # plate and floor line y values, titles
python3 wall_faces.py plans.pdf --page 8 --box 340 80 2320 913 --levels 312,494,522,703,731 --out out/front
```
`--box` is the building's extent on the sheet: just outside the outer walls, above the
ridge, down to the first finish floor line. The plate and floor lines plus the box border
close regions that are open on one side (porch and balcony back walls) into faces. View
`out/front-map.png`: every enclosed face has a number. Classify each labeled face using
the rules in `references/takeoff-method.md` (wall, roof, opening, column, railing, trim,
sky) and write the wall faces into a selection file (schema in
`references/selection-schema.md`), one entry per elevation, as points inside the faces.
Use `--crop ... --zoom 1.5` for busy areas such as a portico. Then:

```bash
python3 wall_takeoff.py out/selection.json --out out/takeoff.json --overlays out
python3 takeoff_pdf.py out/takeoff.json --out Job_Stucco_Takeoff.pdf --title "..." --subtitle "..."
```
Look at every `counted-<elevation>.png` before pricing. If a face merged wall with porch
air, clip it to the wall's x range; if a drawn element is stucco but not enclosed (a dormer
front with an open outline), add it as a manual area with a note.

### 4. Trim and other quantities

Count window and door surrounds (the "6" trim w/keystone" callout) per elevation, belt and
header mouldings by length, and anything else the elevations call out that M3 prices:
control joints and expansion joints are included in the square-foot rate, so they are not
lines. Conventions and allowances are in `references/pricing-rules.md`.

### 5. Price and build the estimate

Write the job file (examples in `examples/`), then:

```bash
python3 build_estimate.py --job job.json --out M3_Estimate_Client_Stucco.pdf
```
The rate card lives in `assets/rates/stucco.json` (and `eifs.json`). Lines carry a `code`
from the card, a `qty`, a `detail` sentence that goes on the estimate, and a `source`
(sheet and view). Group lines with `phase` when the job has separate buildings or areas;
the table then shows subtotals. Per-job items (mobilization) need a `unit_price` on the
line. Render the PDF pages to PNG and look at them before sending anything.

### 6. Report and hand off

Send the estimate PDF, the takeoff review PDF, the job file and (if made) the `.takeoff`.
In the message, give the areas per elevation and the total, state the measuring
conventions used, list every placeholder price with its amount, and name scope questions
(cast stone versus foam trim, interior stucco shown on sections, excluded rooms). After
Marco approves, the filing steps in `references/estimate-format.md` apply (M3 Records
folder, HubSpot); they need his Mac.

## Rules that do not bend

- Quantities are net wall area after deducting openings at the frame. Roofs, soffits,
  columns, railings, balcony slabs, dentil cornices and the slab edge below the finish
  floor are never stucco. Trim rings and moulding bands count as wall area because the
  finish covers them; the foam shapes are priced per foot on top.
- High work is wall area above 12 ft measured from the first finish floor line.
- Never invent a price list. Xactimate and other proprietary price lists are not available
  to you; say so and use the rate card with placeholders flagged.
- Marco's confirmed rates stay as they are in the card; placeholders are labeled as such
  in the card and in your report. Mobilization is per job, sized to the scaffolding.
- Estimate numbers are `M3-MMDDYY-XXX`; the builder generates them from the date and the
  card's scope code. Never write an em dash in anything for Marco.
- Client contact details stay out of anything public. The job file is not committed to a
  public repository.
- When a drawing is ambiguous (porch back wall, a hatch that reads as stone, a section
  showing interior stucco), decide, state the assumption in the report, and let Marco
  overrule. Do not silently skip an area.

## Sanity checks before you send

- Overlays reviewed for every elevation, both methods.
- Rough cross-check: exterior perimeter from the plan times plate height, less 12 to 18
  percent for openings, should land within about 15 percent of the measured total.
- Each elevation's total compared with its neighbors: a side elevation of a house is rarely
  more than the front; a rear with porches is often the largest.
- The estimate PDF renders cleanly: no internal notes leaking from the rate card,
  subtotals add up, exclusions match the job.

## Read next

- `references/takeoff-method.md`: both methods in depth, the face classification rules,
  the list of ways takeoffs have gone wrong and how to catch them.
- `references/pricing-rules.md`: the rate card semantics, current rates and placeholders,
  trim allowances, mobilization and high work.
- `references/estimate-format.md`: the document format, job file fields, numbering, filing.
- `references/selection-schema.md`: every JSON format the scripts read and write.
- `references/worked-examples.md`: three real jobs with commands, numbers and lessons.
