#!/usr/bin/env python3
"""Find stucco regions on an architectural elevation sheet from its vector linework.

Stucco surfaces on CAD elevations carry a stipple hatch drawn as zero-length dot
strokes. Every enclosed face of the sheet's linework that holds those dots at hatch
density is stucco; faces that leak into un-hatched areas (open boundaries such as
stone hatch) are clipped to the hull of their own dots. Windows and doors inside a
face come out as holes, so region areas are net of openings.

    python3 scripts/takeoff/stucco_regions.py sheet.pdf --out out/prefix \
        --zone "Front elevation:220,860,2170,1590" --zone "Right elevation:320,30,2110,810" \
        --exclude 1655,340,2050,705

Coordinates are PDF display points (rotation applied). Scale defaults to 1/4" = 1'-0"
(18 pt per foot) and can be changed with --pt-per-ft. Writes <prefix>.json,
<prefix>-overlay.png and a summary on stdout.
"""
import argparse
import json
import math
import sys
import time

import pymupdf
from shapely import concave_hull
from shapely.geometry import LineString, MultiPoint, MultiPolygon, Point, Polygon, box
from shapely.ops import polygonize, unary_union
from shapely.strtree import STRtree

MIN_FACE = 150        # pt^2, ignore slivers
MIN_HOLE = 400        # pt^2 (~1.2 sq ft at 1/4" scale): smaller holes are hatch, vents or text
WHOLE_DOTS, WHOLE_DENS = 4, 2.0      # dots and dots per 1,000 pt^2 to take a face whole
PART_DOTS, PART_DENS = 8, 0.4        # a leaked face: clip to its dots instead
HULL_RATIO, HULL_PAD = 0.35, 6.0     # concave hull tightness and pad (half the dot spacing)


def bezier(p0, p1, p2, p3, n=6):
    out = []
    for i in range(n + 1):
        t = i / n
        u = 1 - t
        out.append((u ** 3 * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t ** 3 * p3.x,
                    u ** 3 * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t ** 3 * p3.y))
    return out


def extract(page, xmax):
    """Linework segments and stipple dots in display coordinates."""
    M = page.rotation_matrix

    def T(p):
        q = pymupdf.Point(p) * M
        return (q.x, q.y)

    segs, dots = [], []
    for d in page.get_drawings():
        color = tuple(round(c, 2) for c in (d.get("color") or ()))
        if color == (0.9, 0.9, 0.9):          # copyright watermark outlines
            continue
        items = d["items"]
        if len(items) == 1 and items[0][0] == "l":
            a, b = T(items[0][1]), T(items[0][2])
            if math.dist(a, b) < 0.05:
                if a[0] <= xmax:
                    dots.append(a)
                continue
        r = d["rect"]
        if max(r.width, r.height) < 2.5:
            continue
        for it in items:
            pts = None
            if it[0] == "l":
                pts = [T(it[1]), T(it[2])]
            elif it[0] == "re":
                rr = it[1]
                pts = [T(pymupdf.Point(rr.x0, rr.y0)), T(pymupdf.Point(rr.x1, rr.y0)), T(pymupdf.Point(rr.x1, rr.y1)), T(pymupdf.Point(rr.x0, rr.y1)), T(pymupdf.Point(rr.x0, rr.y0))]
            elif it[0] == "qu":
                q = it[1]
                pts = [T(q.ul), T(q.ur), T(q.lr), T(q.ll), T(q.ul)]
            elif it[0] == "c":
                pts = [T(pymupdf.Point(*p)) for p in bezier(it[1], it[2], it[3], it[4])]
            if not pts:
                continue
            for i in range(len(pts) - 1):
                (x0, y0), (x1, y1) = pts[i], pts[i + 1]
                if x0 <= xmax and x1 <= xmax and (x0, y0) != (x1, y1):
                    segs.append((x0, y0, x1, y1))
    return segs, dots


def find_regions(segs, dots, excludes, sqft):
    t = time.time()
    lines = [LineString([(a, b), (c, d)]) for a, b, c, d in segs]
    faces = [f for f in polygonize(unary_union(lines)) if f.area >= MIN_FACE]
    print(f"  {len(lines)} segments -> {len(faces)} faces in {time.time() - t:.0f}s", file=sys.stderr)
    pts = [Point(x, y) for x, y in dots]
    tree = STRtree(pts)
    whole, partial = [], []
    for f in faces:
        if any(f.centroid.within(z) for z in excludes):
            continue
        inside = [pts[i] for i in tree.query(f) if pts[i].within(f)]
        n = len(inside)
        if n == 0:
            continue
        dens = n / (f.area / 1000)
        if n >= WHOLE_DOTS and dens >= WHOLE_DENS:
            whole.append(f)
        elif n >= PART_DOTS and dens >= PART_DENS:
            hull = concave_hull(MultiPoint(inside), ratio=HULL_RATIO).buffer(HULL_PAD)
            clipped = hull.intersection(f)
            if not clipped.is_empty:
                partial.append(clipped)
    merged = unary_union(whole + partial)
    geoms = list(merged.geoms) if isinstance(merged, MultiPolygon) else [] if merged.is_empty else [merged]
    regions = []
    for r in geoms:
        if not isinstance(r, Polygon) or r.area < MIN_FACE:
            continue
        holes = [Polygon(h) for h in r.interiors if Polygon(h).area >= MIN_HOLE]
        gross = Polygon(r.exterior).area
        net = gross - sum(h.area for h in holes)
        regions.append({
            "gross_sqft": round(gross / sqft, 1),
            "net_sqft": round(net / sqft, 1),
            "openings_sqft": [round(h.area / sqft, 1) for h in holes],
            "centroid": [round(r.centroid.x), round(r.centroid.y)],
            "exterior": [[round(x, 1), round(y, 1)] for x, y in Polygon(r.exterior).simplify(1.5).exterior.coords],
            "holes": [[[round(x, 1), round(y, 1)] for x, y in h.simplify(1.5).exterior.coords] for h in holes],
            "clipped": any(r.intersects(p) for p in partial) and not any(r.within(w.buffer(0.5)) for w in whole),
        })
    return regions, whole, partial


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("pdf")
    ap.add_argument("--page", type=int, default=1)
    ap.add_argument("--out", required=True, help="output prefix")
    ap.add_argument("--zone", action="append", default=[], help='"name:x0,y0,x1,y1" label for regions by centroid')
    ap.add_argument("--exclude", action="append", default=[], help="x0,y0,x1,y1 box to ignore (e.g. a crossed-out area)")
    ap.add_argument("--xmax", type=float, default=2300, help="ignore everything right of this x (title block)")
    ap.add_argument("--pt-per-ft", type=float, default=18.0, help='18 for 1/4" = 1\'-0"')
    args = ap.parse_args()

    sqft = args.pt_per_ft ** 2
    zones = []
    for z in args.zone:
        name, coords = z.split(":")
        zones.append((name, box(*map(float, coords.split(",")))))
    excludes = [box(*map(float, e.split(","))) for e in args.exclude]

    doc = pymupdf.open(args.pdf)
    page = doc[args.page - 1]
    t = time.time()
    segs, dots = extract(page, args.xmax)
    print(f"  extracted {len(segs)} segments, {len(dots)} stipple dots in {time.time() - t:.0f}s", file=sys.stderr)
    regions, whole, partial = find_regions(segs, dots, excludes, sqft)
    for r in regions:
        r["zone"] = next((name for name, b in zones if Point(*r["centroid"]).within(b)), "unzoned")
    regions.sort(key=lambda r: (r["zone"], -r["net_sqft"]))

    inv = ~page.rotation_matrix
    sh = page.new_shape()
    for r in regions:
        sh.draw_polyline([pymupdf.Point(x, y) * inv for x, y in r["exterior"]])
        col = (0.9, 0.5, 0) if r["clipped"] else (0, 0.6, 0)
        sh.finish(color=col, fill=col, fill_opacity=0.35, width=1.5, closePath=True)
        for h in r["holes"]:
            sh.draw_polyline([pymupdf.Point(x, y) * inv for x, y in h])
            sh.finish(color=(0.8, 0, 0), fill=(1, 1, 1), fill_opacity=0.9, width=1, closePath=True)
    sh.commit()
    page.get_pixmap(dpi=60).save(f"{args.out}-overlay.png")

    summary = {}
    for r in regions:
        s = summary.setdefault(r["zone"], {"regions": 0, "gross_sqft": 0.0, "net_sqft": 0.0, "openings_sqft": 0.0})
        s["regions"] += 1
        s["gross_sqft"] = round(s["gross_sqft"] + r["gross_sqft"], 1)
        s["net_sqft"] = round(s["net_sqft"] + r["net_sqft"], 1)
        s["openings_sqft"] = round(s["openings_sqft"] + sum(r["openings_sqft"]), 1)
    json.dump({"pdf": args.pdf, "page": args.page, "pt_per_ft": args.pt_per_ft, "summary": summary, "regions": regions}, open(f"{args.out}.json", "w"), indent=1)
    for zone, s in summary.items():
        print(f"{zone}: {s['regions']} regions, gross {s['gross_sqft']} sq ft, openings {s['openings_sqft']} sq ft, net {s['net_sqft']} sq ft")
    for r in regions:
        flag = " (clipped to dots)" if r["clipped"] else ""
        print(f"   {r['zone']:<18} {r['net_sqft']:7.1f} net  gross {r['gross_sqft']:6.1f}  openings {r['openings_sqft']} at {r['centroid']}{flag}")


if __name__ == "__main__":
    main()
