#!/usr/bin/env python3
"""Print the reference levels of an elevation sheet in display points.

    python3 sheet_levels.py set.pdf --page 8 [--pt-per-ft 18]

Finds the text labels architects place on the level lines (T.O. PLATE, 1st FIN. FLR.,
2nd FIN. FLR., ATTIC FIN. FLR., WINDOW HDR.) and prints each one's y, which is the y of
the level line itself within a point or two. Also prints the high-work line (first finish
floor minus 12 ft) and the elevation titles found on the page. Use the plate and floor
values as --levels for wall_faces.py and the first finish floor as ff1 in the selection.
"""
import argparse
import re

import pymupdf

LABELS = r"T\.?O\.? ?PLATE|FIN\.? ?FLR|FINISH(ED)? FLOOR|WINDOW HDR|PLATE HT|TOP OF PLATE|B\.?O\.? ?SOFFIT|GRADE"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("pdf")
    ap.add_argument("--page", type=int, required=True)
    ap.add_argument("--pt-per-ft", type=float, default=18.0)
    args = ap.parse_args()
    page = pymupdf.open(args.pdf)[args.page - 1]
    M = page.rotation_matrix
    lines = {}
    for w in page.get_text("words"):
        lines.setdefault((w[5], w[6]), []).append(w)
    found, titles = [], []
    for ws in lines.values():
        ws.sort(key=lambda w: w[0])
        text = " ".join(w[4] for w in ws)
        r = pymupdf.Rect(min(w[0] for w in ws), min(w[1] for w in ws), max(w[2] for w in ws), max(w[3] for w in ws)) * M
        r.normalize()
        if re.search(LABELS, text, re.I):
            found.append((round((r.y0 + r.y1) / 2), round(r.x0), round(r.x1), text))
        if re.search(r"ELEVATION|SECTION", text) and not re.search(r"SEE|PER|NOTE", text):
            titles.append((round(r.y0), round(r.x0), text))
    print(f"page {args.page}: display size {page.rect.width:.0f} x {page.rect.height:.0f} pt, rotation {page.rotation}")
    for y, x0, x1, text in sorted(found):
        print(f"   y {y:5d}   x {x0:5d}-{x1:5d}   {text}")
    ff = [y for y, _, _, t in found if re.search(r"1st|FIRST|GROUND", t, re.I) and re.search(r"FIN|FLOOR", t, re.I)]
    for y in sorted(set(ff)):
        print(f"   first finish floor at y {y}: high work above y {y - 12 * args.pt_per_ft:.0f} (12 ft at {args.pt_per_ft} pt/ft)")
    if titles:
        print("   titles:")
        for y, x, t in sorted(titles):
            print(f"      y {y:5d} x {x:5d}  {t}")


if __name__ == "__main__":
    main()
