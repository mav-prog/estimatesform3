#!/usr/bin/env python3
"""Inventory a plan set: which pages are elevations, what scale, and whether the stucco is hatched.

    python3 scan_sheets.py set.pdf [--dots] [--json out.json]

Prints one line per page with the display size, the scale strings found, counts of
finish keywords (STUCCO, EIFS, PLASTER, STONE, BRICK, SIDING), the sheet number and the
drawing titles on the page. With --dots it also counts hatch dots per page, which tells
you whether the hatch method (hatch_regions.py) will work or whether you need the
wall-face method (wall_faces.py); it takes a few seconds per page.
"""
import argparse
import json
import re

import pymupdf

from takeoff_common import extract_vectors

KEYWORDS = ["STUCCO", "EIFS", "PLASTER", "STONE", "BRICK", "SIDING", "ELEVATION", "SECTION"]


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("pdf")
    ap.add_argument("--dots", action="store_true", help="count hatch dots per page (slow)")
    ap.add_argument("--json", help="write the inventory here")
    args = ap.parse_args()
    doc = pymupdf.open(args.pdf)
    rows = []
    for i, page in enumerate(doc):
        text = page.get_text()
        up = text.upper()
        counts = {k: len(re.findall(k, up)) for k in KEYWORDS}
        scales = sorted(set(re.findall(r"\d+(?:/\d+)?\"\s*=\s*\d+'-?\d*\"?", text)))
        sheet = re.findall(r"\b[A-Z]{1,2}-?\d{1,2}(?:\.\d{1,2})?\b", text)
        sheet = max(set(sheet), key=sheet.count) if sheet else ""
        titles = sorted(set(t.strip() for t in re.findall(r"\b([A-Z][A-Z0-9 /'\-]{2,40}(?:ELEVATION|PLAN|SECTION)S?)\b", text)
                            if not re.search(r"SEE|PER |NOTE|SHALL|SCALE DRAW", t)))
        row = {"page": i + 1, "width": round(page.rect.width), "height": round(page.rect.height), "sheet": sheet,
               "scales": scales, "keywords": {k: v for k, v in counts.items() if v}, "titles": titles[:8]}
        if args.dots:
            segs, dots = extract_vectors(page)
            row["segments"], row["dots"] = len(segs), len(dots)
        rows.append(row)
        kw = " ".join(f"{k}:{v}" for k, v in row["keywords"].items())
        extra = f" segs {row['segments']} dots {row['dots']}" if args.dots else ""
        print(f"p{i + 1:<3} {row['width']}x{row['height']} {sheet:<6} {', '.join(scales) or '-':<22} {kw}{extra}")
        for t in row["titles"]:
            print(f"      {t}")
    if args.json:
        json.dump(rows, open(args.json, "w"), indent=1)


if __name__ == "__main__":
    main()
