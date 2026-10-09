#!/usr/bin/env python3
"""Review PDF for a wall-face takeoff: a summary page, then each elevation sheet with the
counted stucco shaded green and the part above 12 ft tinted red.

    python3 takeoff_pdf.py out/takeoff.json --out Adams_Residence_Stucco_Takeoff.pdf \
        --title "Adams Residence, 10 Summit Pl., Cedar Hill, TX" \
        --subtitle "Stucco takeoff for estimate M3-100926-STC, JWB Design Studio plan 25376-R3"

This is what the client-facing reviewer (Marco) reads to check the takeoff: it is always
sent with the estimate. Sheets are copied from the plan set named in the takeoff JSON.
"""
import argparse
import datetime
import json
import os
from collections import OrderedDict

import pymupdf
from shapely import wkt
from shapely.geometry import MultiPolygon, Polygon, box

from takeoff_common import display_rect_to_page, draw_polygons

CRIMSON = (0.64, 0.12, 0.20)
DARK = (0.13, 0.13, 0.13)
GREEN = (0.0, 0.55, 0.15)
HIGH_FT = 12.0
NOTES = ("How to read the sheets that follow: every area counted as stucco is shaded green. The part of it above 12 ft "
         "from the first finish floor line, priced as high work, is tinted red on top of the green. Openings, roofs, "
         "columns, railings, balcony slabs, dentil cornices and the slab edge are left white and are not counted. Window "
         "and door trim rings and the belt and header mouldings are counted as wall area because the finish coat covers "
         "them; the foam shapes themselves are priced separately per foot. Areas were measured on the vector linework of "
         "the elevations by enclosing each wall face and subtracting the openings inside it. Wall slivers under 5 sq ft "
         "were not counted, so the figures run slightly conservative.")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("takeoff")
    ap.add_argument("--out", required=True)
    ap.add_argument("--title", required=True)
    ap.add_argument("--subtitle", default="")
    ap.add_argument("--company", default="M3 Construction Services LLC")
    ap.add_argument("--notes", default=NOTES)
    args = ap.parse_args()
    t = json.load(open(args.takeoff))
    base = os.path.dirname(os.path.abspath(args.takeoff))
    ppu = t["pt_per_ft"]
    elevs = t["elevations"]
    groups = t.get("groups") or {"All elevations": list(elevs)}
    out = pymupdf.open()

    pg = out.new_page(width=612, height=792)
    y = 60
    pg.insert_text((54, y), args.company, fontsize=11, fontname="helv", color=CRIMSON); y += 22
    pg.insert_text((54, y), args.title, fontsize=16, fontname="hebo", color=DARK); y += 20
    if args.subtitle:
        pg.insert_text((54, y), args.subtitle, fontsize=9.5, fontname="helv", color=DARK); y += 14
    pg.insert_text((54, y), datetime.date.today().strftime("Prepared %B %d, %Y"), fontsize=9.5, fontname="helv", color=DARK); y += 28
    cols = [54, 300, 410, 520]
    for x, h in zip(cols, ["Elevation", "Stucco, net sq ft", "Above 12 ft", "Sheet"]):
        pg.insert_text((x, y), h, fontsize=10, fontname="hebo", color=CRIMSON)
    y += 6
    pg.draw_line((54, y), (558, y), color=CRIMSON, width=1); y += 16

    def row(label, total, high, sheet, bold=False):
        nonlocal y
        f = "hebo" if bold else "helv"
        for x, s in zip(cols, [label, f"{total:,.0f}", f"{high:,.0f}", sheet]):
            pg.insert_text((x, y), s, fontsize=10, fontname=f, color=DARK)
        y += 16

    gt = gh = 0
    for gname, members in groups.items():
        st = sh = 0
        for m in members:
            e = elevs[m]
            row(m.replace("_", " ").capitalize(), e["total"], e["high"], f"p.{e['page']}")
            st += e["total"]; sh += e["high"]
        if len(groups) > 1:
            row(gname, st, sh, "", bold=True); y += 6
        gt += st; gh += sh
    pg.draw_line((54, y - 10), (558, y - 10), color=CRIMSON, width=1)
    row("Total", gt, gh, "", bold=True); y += 14
    pg.insert_textbox(pymupdf.Rect(54, y, 558, y + 170), args.notes, fontsize=9.5, fontname="helv", color=DARK, lineheight=1.25)
    y += 180
    pg.draw_rect(pymupdf.Rect(54, y, 70, y + 12), color=GREEN, fill=(0.6, 0.9, 0.65))
    pg.insert_text((76, y + 10), "Counted stucco wall area", fontsize=9.5, fontname="helv", color=DARK)
    pg.draw_rect(pymupdf.Rect(230, y, 246, y + 12), color=GREEN, fill=(0.85, 0.55, 0.5))
    pg.insert_text((252, y + 10), "Counted, and above 12 ft (high work)", fontsize=9.5, fontname="helv", color=DARK)

    # one output page per (pdf, page), with every elevation on it
    sheets = OrderedDict()
    for name, e in elevs.items():
        pdf = e["pdf"] if os.path.isabs(e["pdf"]) else os.path.join(base, e["pdf"])
        sheets.setdefault((pdf, e["page"]), []).append(name)
    docs = {}
    for (pdf, pno), names in sheets.items():
        src = docs.setdefault(pdf, pymupdf.open(pdf))
        out.insert_pdf(src, from_page=pno - 1, to_page=pno - 1)
        page = out[-1]
        for name in names:
            e = elevs[name]
            g = wkt.loads(e["wkt"])
            polys = list(g.geoms) if isinstance(g, MultiPolygon) else [g]
            draw_polygons(page, polys, GREEN, (0.1, 0.75, 0.3), 0.35)
            high = g.intersection(box(-1e9, -1e9, 1e9, e["ff1"] - HIGH_FT * ppu))
            draw_polygons(page, list(high.geoms) if hasattr(high, "geoms") else [high], None, (0.95, 0.15, 0.1), 0.22)
        lines = [f"{n.replace('_', ' ').capitalize()}: {elevs[n]['total']:,.0f} sq ft stucco, {elevs[n]['high']:,.0f} sq ft above 12 ft" for n in names]
        W = page.rect.width
        bw, bh = 460, 40 + 20 * len(lines)
        x0, y0 = W - bw - 234, 55          # just left of a typical title block
        x1, y1 = x0 + bw, y0 + bh
        inv = ~page.rotation_matrix
        sh = page.new_shape()
        sh.draw_polyline([pymupdf.Point(x, y) * inv for x, y in [(x0, y0), (x1, y0), (x1, y1), (x0, y1), (x0, y0)]])
        sh.finish(color=CRIMSON, fill=(1, 1, 1), fill_opacity=0.95, width=1.2, closePath=True)
        sh.commit()
        tb = display_rect_to_page(page, x0 + 10, y0 + 8, x1 - 10, y1 - 8)
        rc = page.insert_textbox(tb, "Counted stucco (green), above 12 ft (red tint)\n" + "\n".join(lines),
                                 fontsize=11, fontname="hebo", color=CRIMSON, rotate=page.rotation)
        if rc < 0:
            print(f"warning: label did not fit on page {pno}")
    out.save(args.out, garbage=3, deflate=True)
    print(f"wrote {args.out}: {len(out)} pages, {gt:,.0f} sq ft counted, {gh:,.0f} above 12 ft")


if __name__ == "__main__":
    main()
