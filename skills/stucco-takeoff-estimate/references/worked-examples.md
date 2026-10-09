# Worked examples

Three jobs done with this workflow in September and October 2026, with the commands,
the numbers and what each one taught.

## 1. Custom home, Fort Worth area: hatch method (stucco over the whole house)

Set: four elevation sheets (A3 to A6) from a residential designer, 36 x 24 in, 1/4" = 1'-0"
(18 points per foot), stucco drawn with a sand hatch, stone veneer with a stone hatch, a
game room crossed out on the plans (excluded work). The title block logo was 109,000 dots.

```bash
python3 hatch_regions.py A3.pdf --out out/A3 \
    --zone "Front elevation:220,860,2170,1590" --zone "Right elevation:320,30,2110,810" \
    --exclude 1655,340,2050,705
python3 hatch_regions.py A4.pdf --out out/A4 --zone "Left elevation:..." --zone "Rear elevation:..."
python3 high_work.py out/A3.json out/A4.json out/A6.json --floor "Front elevation:1560" ... --out out/items.json
python3 regions_to_takeoff.py --name "Park St stucco" --out park.takeoff "A3:A3.pdf:out/A3.json" ...
python3 build_estimate.py --job job.json --takeoff out/items.json
```

Results (net, sq ft): A3 front 313.8 + right 454.3; A4 left 188.0 + rear 253.8; A5 none; A6
section 108.2 (an interior fireplace chase, a scope question). Priced at $11.00/sq ft with
a high-work line at $1.25 and accessories included; the first version at $10 was bumped to
$11 by Marco.

Lesson: that run used exact noding. Re-measured later with snap rounding (the app's
detector and `hatch_regions.py`): A3 704, A4 426, A6 73 sq ft, about 115 sq ft less.
Overlays showed the exact-noding faces had leaked through hairline gaps into the stone
veneer beside the gables and into a bookcase niche beside the fireplace. Always look at the
overlays; never trust a region that crosses a drawn material line.

## 2. McDonald's, Godley TX: EIFS bands, small commercial job

Set: a six-sheet corporate standard building, 1/4" scale, EIFS called out by tag "E" on two
canopy bands (front and non-drive-thru elevations), 29 ft long, from the top of canopy to
the 18'-3" fascia, between aluminum batten towers; control joint tags CJ type 1.

```bash
python3 hatch_regions.py A2.0.pdf --out out/A20 --zone "Front elevation:..." --zone "Non-drive-thru elevation:..."
```
Results: 229.8 + 200.4 sq ft net (the band hatch was dots; the app detector later gave
230.5 + 202.4). Lines: EIFS_SYSTEM 195.75 sq ft x 2 (the drawn band rectangles, 29'-0" x
6'-9"), CONTROL_JOINT 27 ft and TERMINATION 143 ft (included, reported), HIGH_WORK 362.5 sq
ft (the bands from 12 ft to 18'-3"), SMALL_JOB_PREMIUM (392 sq ft total), MOBILIZATION
$1,500 (scaffold or lift at two facades). Total $9,100.50. Marco asked for "Xactimate
pricing": not available, said so, used DFW placeholders; he submitted it as produced.

Lesson: on commercial sets the quantity is often the drawn band rectangle, and the drawing's
own dimensions (29'-0" x 6'-9") are the defensible quantity; the hatch confirms it.

## 3. Adams Residence, Cedar Hill TX: wall-face method, two buildings

Set: 17 sheets from JWB Design Studio (plan 25376-R3, 09/18/26), 42 x 30 in, 1/4" scale.
Whole house and a detached guest house in stucco with 6" foam trim and keystones, belt
mouldings, dentil cornices, mansard roofs with dormers, a two-story front portico and a
two-story rear porch with balconies. No hatch at all on the elevations (166 to 682 dots per
sheet, all decoration), so the hatch method found nothing and the wall-face method was used.

```bash
python3 scan_sheets.py adams.pdf --dots                 # A8 front, A9 left, A10 rear, A11 right, A17 detached (4 views)
python3 sheet_levels.py adams.pdf --page 8              # 312 494 522 (558) 703 731 (830) 913
python3 wall_faces.py adams.pdf --page 8  --box 340 80 2320 913   --levels 312,494,522,703,731 --out out/front
python3 wall_faces.py adams.pdf --page 9  --box 680 80 2270 939   --levels 338,520,548,729,757 --out out/left
python3 wall_faces.py adams.pdf --page 10 --box 465 80 2455 960   --levels 359,541,569,750,778 --out out/rear
python3 wall_faces.py adams.pdf --page 11 --box 620 80 2175 971   --levels 370,552,580,762,790 --out out/right
python3 wall_faces.py adams.pdf --page 17 --box 360 120 1080 621  --levels 358,411,440 --out out/dleft
python3 wall_faces.py adams.pdf --page 17 --box 1320 120 2570 621 --levels 358,411,440 --out out/dfront
python3 wall_faces.py adams.pdf --page 17 --box 390 1400 1120 1932  --levels 1722,1750 --out out/dright
python3 wall_faces.py adams.pdf --page 17 --box 1320 1400 2590 1932 --levels 1722,1750 --out out/drear
#  classify on the maps, write out/selection.json (examples/adams-selection.json)
python3 wall_takeoff.py out/selection.json --out out/takeoff.json --overlays out
python3 takeoff_pdf.py out/takeoff.json --out Adams_Residence_Stucco_Takeoff.pdf --title "Adams Residence, 10 Summit Pl., Cedar Hill, TX"
python3 build_estimate.py --job examples/adams-residence-stucco-job.json
```

Results (net sq ft, above 12 ft): front 1,643 / 729; left 1,074 / 423; rear 1,648 / 887;
right 1,134 / 617; main house 5,499 / 2,657. Detached: front 551 / 101 (two dormer fronts
added by hand, 20 sq ft), left 232, rear 525, right 97; 1,404 / 101. Total 6,903 / 2,757.
Trim: 66 + 12 trimmed openings at 24 ft, 640 ft of mouldings. Estimate M3-100926-STC,
$119,265.50 with the trim at placeholder prices and mobilization $7,500; without trim
about $86,900.

Decisions made and reported: the walls behind the portico and rear porch columns count
(the wall continues behind them); column strips count as hidden wall; dentil cornices,
soffits, railings, balcony slabs and the slab edge do not; trim rings and belt bands count
as wall; cornices are excluded; the cast-stone-versus-foam question for the trim was put to
Marco; the wall sections specify lath and two coats over ZIP R-6 sheathing, noted on the
estimate. A cross-check from the building program (10,586 sq ft under roof) by perimeter
gave about 7,900 sq ft before the detailed count, so 6,903 was plausible.

Lessons: level lines without the window header lines (those cut the trim rings into
unlabeled pieces); closure lines are what made the porch back walls appear; the rear
elevation is mirrored relative to the plan; a label whose bbox reaches the box edge with a
small area is a merged wall-plus-air face, handled with a clip.
