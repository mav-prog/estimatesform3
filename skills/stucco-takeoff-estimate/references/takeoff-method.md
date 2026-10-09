# Takeoff method

How the stucco area is measured, why it is measured that way, and where it goes wrong.

Contents
1. Coordinates and scale
2. What the scripts read from the PDF
3. The hatch method
4. The wall-face method and the classification rules
5. High work
6. Trim and other counts
7. Cross-checks and known failure modes
8. Hand-off to ProTakeoff

## 1. Coordinates and scale

Every number the scripts print or accept is in PDF display points: the sheet as it is
displayed (page rotation applied), origin at the top-left corner, 72 points per inch, y
growing downward. A 36 x 24 in sheet is 2592 x 1728 points; 42 x 30 in is 3024 x 2160.
Architectural PDFs are usually stored rotated (a portrait page with /Rotate 90); pymupdf
handles that through `page.rotation_matrix`, which `takeoff_common.extract_vectors` applies,
so you never deal with the unrotated space except when drawing (the helpers do it).

Scale comes from the drawing title ("1/4" = 1'-0"") and is the only thing that turns points
into feet: at 1/4" = 1'-0" one foot is 18 points, at 1/8" it is 9, at 3/16" it is 13.5,
at 1/2" it is 36. Verify the scale against a dimension string on the sheet when you can
(a 20'-0" dimension should span 360 points at 1/4"). Different views on one sheet can have
different scales; details and wall sections usually do.

## 2. What the scripts read from the PDF

`extract_vectors` walks every stroked and filled path on the page and returns straight
segments (curves flattened to 6 pieces) plus "dots". Three filters matter:

- Light-gray (0.9) strokes and fills are dropped. Architects' copyright watermarks are
  drawn as large outlined letters across the sheet; left in, they cut wall faces in half.
- Paths smaller than 2.5 points are dropped: text glyphs converted to outlines, hatch
  fragments, dimension ticks. They never bound a wall but they cost time and create slivers.
- A path that is a single zero-length line is a hatch dot. CAD sand/stipple hatch
  (AutoCAD AR-SAND and friends) exports exactly like that: thousands of zero-length strokes.
  Roof tile hatch is chains of short triangles, stone is irregular closed polygons, brick
  is rectangles; none of them are dots.

Polygonization (`polygonize_segments`) snaps every coordinate to a 0.1 point grid before
noding (`shapely.set_precision` + `unary_union`) and then builds faces with
`polygonize`. The snap rounding matters: CAD linework is full of ends that miss their
target line by a few hundredths of a point. Exact noding leaves those gaps open and a wall
face then "leaks" into the neighboring stone veneer or into the sky; snap rounding closes
them. The first prototype of this pipeline used exact noding and over-counted one house by
about nine percent for that reason.

## 3. The hatch method (`hatch_regions.py`)

Use it when the stucco walls carry hatch. The idea: every enclosed face of the linework
that contains hatch dots at hatch density is stucco, and the face boundary, not the hatch
extent, is the stucco boundary. Architects hatch inconsistently (a leader "STUCCO" with a
few dots in the corner is common), so a face with sparse dots still counts in full.

Steps, as implemented:
1. Group the dots into clusters on a 24 point grid. Cells with more than 200 dots per 1,000
   square points are artwork (stippled logos: one title block held 109,000 dots) and are
   dropped with a two-cell margin. Clusters with fewer than 4 dots are strays.
2. Around each cluster take a working box (cluster extent plus 240 points) and polygonize
   only the linework that touches it. Title blocks, notes and details never get noded.
3. For each face at least 0.5 square units: count the dots inside.
   - at least 4 dots and at least 2.0 dots per 1,000 square points: take the whole face;
   - at least 8 dots and at least 0.4 per 1,000: the face leaked through an open outline;
     keep only the concave hull of its dots, padded 6 points, intersected with the face;
   - fewer: ignore (text, a stray dot, a stone face with a dot in it).
4. Dots that fall in no face at all (an outline that never closes) are grouped and their
   padded hull is taken, if the group has at least 8 dots at partial density.
5. Faces and hulls are unioned; holes of at least 1.25 square units are openings (windows,
   doors); smaller holes are hatch gaps, fixtures or text and are filled.

Options: `--zone "Name:x0,y0,x1,y1"` labels each region by the zone its centroid falls in
(one zone per elevation view, read the boxes off a thumbnail); `--exclude x0,y0,x1,y1`
drops dots and faces in a box (a crossed-out room, a detail that repeats an elevation);
`--xmax` ignores everything right of an x (only needed when a hatched legend sits in the
title block).

What it misses: stucco drawn without any hatch (add by hand or use the wall-face method
for that sheet). What it catches wrongly: any dot hatch is "stucco" to it, so concrete
stipple on foundation sections, the sand hatch on a fireplace chase in a building section,
or a hatched interior wall will show up. The overlay PNG exists so you look at every region
and drop what is not exterior stucco, then say what you dropped in the report.

Performance: about 10 seconds per sheet, almost all of it pymupdf reading the drawings.

## 4. The wall-face method (`wall_faces.py`, `wall_takeoff.py`)

Use it when elevations are drawn plain. The idea: the drawn outline of every wall panel is
a closed face once the sheet's linework is noded; roofs, windows, columns and trim are
their own faces. You classify faces, the script sums the wall ones.

### Setting up an elevation
1. `sheet_levels.py` prints the y of every level label: T.O. PLATE, 1st FIN. FLR., 2nd
   FIN. FLR., ATTIC FIN. FLR., WINDOW HDR. Use the plate and floor lines as `--levels`.
   Leave the window header lines out: they only cut the window trim rings into pieces.
2. The box: left and right edges a few points outside the outermost wall lines (porch
   columns included if the porch back wall is parallel to the view), top above the ridge,
   bottom at the first finish floor line (so the slab edge strip below it falls outside).
   The box border plus the level lines turn open regions (porch air, balcony back walls)
   into faces; without them a wall behind a porch is not a face at all and is lost.
3. Run `wall_faces.py`, open the map. Faces 5 square units and larger are labeled with
   their id; the console lists id, net area and bbox for the same faces.

### Classification rules

| Looks like | Class | Count? |
|---|---|---|
| Panel between corners, floor/plate lines and openings, with the "STUCCO" leader or the same finish as its neighbors | wall | yes |
| Dormer front (the ring around the dormer window), gable tympanum, pediment field, chimney shaft and cap, attic-level wall under a cornice, pilaster strip | wall | yes |
| Belt moulding at a floor line, header moulding above windows, plain frieze band | band | yes (foam priced per foot on top) |
| Window or door trim ring (6" trim) | ring | yes |
| Column strip in front of a wall (round or square column, porch or portico) | column | yes if the wall continues behind it; no if the column sits where the wall is open (porch end seen from the side) |
| Roof plane, mansard, hip end, mansard flare strip between the attic floor line and the eave, roof of a wing in front of a wall | roof | no |
| Window glass, sash, muntin cells, door leaves, garage door panels, screen panels | opening | no |
| Dentil cornice, raking cornice, soffit, fascia | cornice | no |
| Balustrade, railing, balcony slab edge, porch beam/ceiling band | railing | no |
| Strip below the first finish floor line (slab edge) | base | no, unless Marco says the slab edge is stuccoed |
| Region outside the building outline but inside the box (above a wing roof, beside a gable) | sky | no |
| Area between porch columns in a side view (looking along the porch) | air | no |

Decide ambiguous faces by what the material would be in the field, state the decision in
the report, and move on. Small faces under 5 square units (window panes, balusters,
dentils, slivers between a window and a corner) are not summed; the total is therefore
two to three percent conservative, which is said on the review PDF.

### Selection file and clips
Write one entry per elevation with points inside the wall faces (a face's label position
or its centroid from the JSON; points survive re-running `wall_faces.py`, ids may not).
A face that merged a wall panel with porch air (a long thin region whose bbox runs to the
box edge, with a label far from where you expect) is kept only between two x values with a
clip. A stucco element the linework never closes (a dormer front whose cheeks are open)
is added as a manual area with a note. `wall_takeoff.py` prints the sums and writes
`counted-<elevation>.png` for each elevation: green is counted, red tint is above 12 ft.
Compare each overlay with the rendering on the sheet (most sets include one): every white
wall in the rendering must be green in the overlay, every roof white.

Iterate: a wrong face is a wrong number. Use `--crop x0 y0 x1 y1 --zoom 1.5` for a
portico, a stacked porch or a dormer row, where the 0.75 map is too small to read.

## 5. High work

High work is the wall area above 12 ft from the first finish floor line (the ground line
is within a foot of it on a slab house). For hatch regions `high_work.py --floor "Zone:y"`
clips every region at `y - 12 * points_per_foot`; `wall_takeoff.py` does the same with
`ff1`. On a two-story house with 10 ft plates this is close to "everything on the second
floor and above", which is the number Marco uses to size scaffolding.

## 6. Trim and other counts

- Window and door surrounds ("6" TRIM w/KEYSTONE"): count the trimmed openings per
  elevation on the face maps; allow 24 ft of trim per opening (a 5.7 x 6.7 ft ring), one
  keystone each. Arched openings: add the arc length.
- Belt and header mouldings: the length of each band across the elevations where it runs;
  the sum of elevation widths at that level is a good estimate.
- Cornices with dentils are usually wood or foam by others; list them in the exclusions.
- Control joints, expansion joints, casing bead, weep screed, corner bead: included in the
  square-foot rate per Marco; never separate lines.
- Openings count toward nothing else: they are deducted from the wall area at the frame.

## 7. Cross-checks and known failure modes

- Exact noding leaks: the prototype counted stone veneer next to stucco gables and a
  bookcase niche beside a fireplace chase. Snap rounding fixed it; still look at overlays.
- A title block logo made of 109,000 dots will swamp the hatch clustering if the density
  filter is off, and will take minutes to node. The cluster boxes keep it out.
- Dashed level lines do not split faces (they are separate dashes); solid closure lines do,
  which is why the wall-face method adds them deliberately and the hatch method never does.
- Window header closure lines cut trim rings into pieces below the 5 square unit threshold
  and make the total drop by the ring areas. Use plate and floor lines only.
- A porch back wall parallel to the view is real stucco and is often not enclosed; the
  box border plus level lines recover it. A porch seen end-on is air: do not count the
  region between its columns.
- Columns in front of a wall hide wall that still gets stucco; count the strip. Columns
  at the open end of a porch hide nothing; do not.
- Mansard roofs: the strip between the attic floor line and the eave is the roof's lower
  flare, not wall. The dormer fronts on it are wall; the dormer cheeks are only visible
  on side elevations and are small.
- A rear elevation is viewed from behind: its left is the house's right. Keep that straight
  when matching attic-level walls between side and rear views.
- Interior stucco on building sections (a fireplace chase, a courtyard wall) is a scope
  question for Marco, not an automatic include.
- A crossed-out area on the plans (an "X" over a room) is excluded work: use `--exclude`
  and say so in the estimate.
- If the plans specify a different system (one-coat, EIFS, stucco over ZIP R-sheathing,
  gypsum backing with two coats), say so on the estimate; the rate card describes M3's
  three-coat system and the client should see the difference.
- Sanity: a two-story custom home runs 1,000 to 1,700 square feet of stucco per
  elevation; a side elevation larger than the front is suspicious; the cover sheet's
  square footages give the perimeter estimate in section "Sanity checks" of SKILL.md.

## 8. Hand-off to ProTakeoff

`regions_to_takeoff.py` writes a `.takeoff` project: one plan page per sheet PDF, the page
scale set to the points per foot you used, one AREA item per zone with the regions as
shapes and the openings as cutouts. Because the coordinates are display points, the app's
values equal the scripts' values. The app (ProTakeoff, Marco's Mac build) also carries the
hatch detector built in (toolbar sparkles button, "Detect stucco"); it is the same
algorithm as `hatch_regions.py` and gives the same numbers within a square foot or two.
