# File formats

All coordinates are display points (see takeoff-method.md section 1). Areas are in square
units of the sheet scale (square feet at 18 points per foot).

## faces JSON (written by wall_faces.py)
```json
{"pdf": "plans.pdf", "page": 8, "box": [340, 80, 2320, 913], "levels": [312, 494, 522, 703, 731],
 "vlines": [], "pt_per_ft": 18,
 "faces": [{"id": 1, "net": 1124.0, "gross": 1124.0, "cx": 1330, "cy": 196,
            "bbox": [340, 80, 2320, 312],
            "exterior": [[x, y], ...], "holes": [{"area": 6.5, "ring": [[x, y], ...]}]}]}
```
Faces are sorted largest first; ids are 1-based in that order.

## selection JSON (you write it; read by wall_takeoff.py)
```json
{"pt_per_ft": 18,
 "elevations": {
   "front": {"faces": "out/front.json", "ff1": 913,
             "points": [[1050, 820], [2060, 830]],
             "ids": [5, 7],
             "clips": [{"point": [1233, 829], "x": [891, 2054]}, {"id": 8, "x": [1364, 2036]}],
             "manual": [{"sqft": 20.0, "high": true, "note": "two dormer fronts the linework does not enclose"}]}},
 "groups": {"Main house": ["front", "left", "rear", "right"], "Detached house": ["dfront", "dleft", "drear", "dright"]}}
```
- `faces`: path to the faces JSON, relative to the selection file.
- `ff1`: first finish floor y; high work is everything above `ff1 - 12 * pt_per_ft`.
- `points` and `ids` both select faces; a point selects the face that contains it.
- `clips`: keep only the part of a face between two x values.
- `manual`: areas added by hand (square units), `high` true if above 12 ft.
- `groups`: phase names in the order they appear on the estimate.

## takeoff JSON (written by wall_takeoff.py, read by takeoff_pdf.py)
```json
{"pt_per_ft": 18, "groups": {...},
 "elevations": {"front": {"total": 1642.7, "high": 729.4, "pdf": "plans.pdf", "page": 8,
                          "box": [...], "ff1": 913, "faces_selected": ["5", "7", "clip0"],
                          "manual": [...], "wkt": "MULTIPOLYGON (...)"}}}
```

## regions JSON (written by hatch_regions.py; read by high_work.py and regions_to_takeoff.py)
```json
{"pdf": "sheet.pdf", "page": 1, "pt_per_ft": 18, "method": "hatch",
 "summary": {"Front elevation": {"regions": 7, "gross_sqft": 358.6, "net_sqft": 313.8, "openings_sqft": 44.7}},
 "regions": [{"zone": "Front elevation", "gross_sqft": 198.8, "net_sqft": 154.0, "openings_sqft": [44.7],
              "centroid": [946, 1140], "exterior": [[x, y], ...], "holes": [[[x, y], ...]], "clipped": false}]}
```

## takeoff items JSON (written by high_work.py; `build_estimate.py --takeoff` accepts it)
```json
{"items": [{"label": "Stucco - all elevations", "type": "AREA", "unit": "sq ft", "totalValue": 1204.3, "shapes": [], "source": "..."},
           {"label": "High work above 12 ft", "type": "AREA", "unit": "sq ft", "totalValue": 1052.0, "shapes": [], "source": "..."}],
 "per_zone": {...}}
```
Item labels are matched to rate codes through the rate card's `takeoff_map` (regular
expressions): "stucco" to STUCCO_3COAT, "high work" to HIGH_WORK, "moulding" to FOAM_BAND,
and so on. A ProTakeoff `.takeoff` export works the same way (`--takeoff file.takeoff`).

## job JSON (you write it; read by build_estimate.py)
```json
{"date": "2026-10-09", "rates": "stucco",
 "client": {"name": "Contact name", "company": "Company", "email": "", "phone": ""},
 "project": "Address and plan reference, one or two sentences.",
 "scope_summary": "One sentence shown under Scope: on page one.",
 "lines": [
   {"code": "STUCCO_3COAT", "phase": "Main house", "qty": 5499.2,
    "detail": "Sentence that goes on the estimate after the rate description.", "source": "sheets A8 to A11"},
   {"code": "MOBILIZATION", "phase": "Both buildings", "qty": 1, "unit_price": 7500.0, "detail": "...", "source": ""}],
 "owner_furnished_note": "", "exclusions_extra": "Job-specific exclusions appended to the card's paragraph.",
 "payment_terms": "optional override", "estimate_number": "optional override",
 "output": "M3_Estimate_Client_Stucco.pdf"}
```
`phase` is optional; when any line has one, the table gets a header row and a subtotal per
phase. Lines with the same code after the first print "As specified above." instead of the
rate description. Per-job items need `unit_price` on the line. Quantities are rounded up
per the card's rounding rule (`ceil` for sq ft, ft and EA).

## rate card JSON (assets/rates/*.json)
```json
{"trade": "stucco", "scope_code": "STC", "status": "...", "rounding": {"sq ft": "ceil", "ft": "ceil", "EA": "ceil", "LS": "none"},
 "items": {"STUCCO_3COAT": {"name": "...", "description": "...", "unit": "sq ft", "unit_price": 11.0},
           "WEEP_SCREED": {"name": "...", "description": "...", "unit": "ft", "included_in": "STUCCO_3COAT"},
           "SMALL_JOB_PREMIUM": {"name": "...", "description": "...", "unit": "LS", "percent_of": "EIFS_SYSTEM", "percent": 20},
           "MOBILIZATION": {"name": "...", "description": "...", "unit": "LS", "unit_price": null}},
 "takeoff_map": [{"match": "stucco", "code": "STUCCO_3COAT"}],
 "scope_intro_exceptions": "", "scope_sections": [{"title": "...", "bullets": ["..."]}],
 "exclusions": "paragraph", "payment_terms": "sentence"}
```
