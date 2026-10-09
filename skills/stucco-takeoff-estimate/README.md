# stucco-takeoff-estimate

A skill for an AI agent (Claude, Hermes or any agent that can run Python and look at
images) that turns an architectural PDF plan set into a stucco or EIFS takeoff and an
M3 Construction Services estimate. It packages the exact workflow, scripts and rules
developed with Marco Vazquez (M3, Fort Worth, TX) on real jobs in 2026.

## What is in the folder

```
stucco-takeoff-estimate/
├── SKILL.md                     the agent instructions: workflow, rules, checks (read first)
├── README.md                    this file
├── scripts/
│   ├── requirements.txt         pymupdf, shapely, reportlab, Pillow
│   ├── check_env.py             verifies the Python setup; run first on a new machine
│   ├── takeoff_common.py        vector extraction, snap-rounded polygonization, drawing helpers
│   ├── scan_sheets.py           inventory of a plan set (sizes, scales, finish keywords, hatch dots)
│   ├── sheet_levels.py          plate and floor line y values of an elevation sheet
│   ├── hatch_regions.py         stucco regions from the sand/stipple hatch (hatched elevations)
│   ├── high_work.py             split hatch regions at 12 ft above the finish floor
│   ├── wall_faces.py            polygonize an elevation into numbered faces + face map (plain elevations)
│   ├── wall_takeoff.py          sum the selected wall faces, 12 ft split, counted overlays
│   ├── takeoff_pdf.py           review PDF: summary page + sheets with the counted areas shaded
│   ├── regions_to_takeoff.py    ProTakeoff project file (.takeoff) from regions
│   └── build_estimate.py        the M3 estimate PDF from a job file and a rate card
├── assets/rates/
│   ├── stucco.json              three-coat stucco rate card, scope text, exclusions, takeoff matching
│   └── eifs.json                EIFS rate card
├── examples/
│   ├── adams-selection.json     wall-face selection for a real two-building job
│   ├── adams-residence-stucco-job.json   the job file behind that estimate
│   ├── mcdonalds-godley-eifs-job.json    an EIFS job file (small commercial bands)
│   └── sample-stucco-test-sheet.json     minimal job file
└── references/
    ├── takeoff-method.md        how the measuring works and the classification rules
    ├── pricing-rules.md         rate card semantics, current rates, placeholders
    ├── estimate-format.md       the estimate document, job file, numbering, filing
    ├── selection-schema.md      every JSON format
    └── worked-examples.md       three jobs end to end
```

## Quick start

```bash
cd scripts
python3 check_env.py                 # lists missing packages; on a locked-down Mac make a venv first:
                                     #   python3 -m venv ~/.venvs/stucco && source ~/.venvs/stucco/bin/activate
pip install -r requirements.txt      # pymupdf, shapely, reportlab, Pillow (prebuilt wheels, no compiler needed)
python3 check_env.py                 # must print "ready"

# 1. What is on the set?
python3 scan_sheets.py ../plans/set.pdf --dots

# 2a. Hatched elevations: regions straight from the hatch
python3 hatch_regions.py ../plans/set.pdf --page 8 --out ../out/A3 --zone "Front elevation:220,860,2170,1590"

# 2b. Plain elevations: faces, then your selection, then the sums
python3 sheet_levels.py ../plans/set.pdf --page 8
python3 wall_faces.py ../plans/set.pdf --page 8 --box 340 80 2320 913 --levels 312,494,522,703,731 --out ../out/front
#   (look at ../out/front-map.png, write ../out/selection.json)
python3 wall_takeoff.py ../out/selection.json --out ../out/takeoff.json --overlays ../out
python3 takeoff_pdf.py ../out/takeoff.json --out ../out/Takeoff.pdf --title "Job name"

# 3. Price it
python3 build_estimate.py --job ../out/job.json --out ../out/M3_Estimate_Client_Stucco.pdf
```

All coordinates the scripts print or accept are PDF display points: origin top-left of the
sheet as displayed, 72 per inch, so at 1/4" = 1'-0" a foot is 18 points. ProTakeoff stores
shapes in the same space, which is why `.takeoff` files made here open with the right values.

## Using it with Hermes or another agent

Give the agent this folder and tell it to read `SKILL.md` first, then follow the workflow.
The agent needs: a shell with Python 3.10+, the ability to view PNG images (the face maps
and overlays are how it checks its own work), and the plan set as a PDF. Nothing here
needs network access. The two things that require judgment, and where the agent should
slow down, are the face classification on plain elevations (rules in
`references/takeoff-method.md`) and the scope decisions it must report back to Marco.

## Updating prices

Edit `assets/rates/stucco.json`. Each item has a `unit_price`; items marked
`included_in` are part of another item's price and only reported; `percent_of` items are
priced as a percentage of other lines; `unit_price: null` items (mobilization) are priced
per job on the job file line. See `references/pricing-rules.md` for what is confirmed and
what is a placeholder.
