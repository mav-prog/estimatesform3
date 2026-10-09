#!/usr/bin/env python3
"""Find stucco regions on an elevation sheet from its stucco hatch.

CAD elevations that hatch stucco draw the sand/stipple pattern as thousands of tiny
zero-length strokes ("dots"). Every enclosed face of the linework that holds dots at hatch
density is stucco (taken whole, because architects hatch inconsistently and the drawn
outline is the real boundary); a face that leaks through an open outline is clipped to the
hull of its dots; hatch that no face encloses is taken as the hull of the dot group.
Openings inside a face become holes, so areas are net of windows and doors.

    python3 hatch_regions.py sheet.pdf --page 1 --out out/A3 \
        --zone "Front elevation:220,860,2170,1590" --zone "Right elevation:320,30,2110,810" \
        --exclude 1655,340,2050,705

Writes <out>.json (regions in display points, net/gross/openings in square units) and
<out>-overlay.png. Title blocks, logos and notes are ignored automatically: only linework
around real hatch clusters is examined, and dots packed far denser than any hatch (stippled
logos) are dropped. Use --zone to label regions by elevation and --exclude to drop an area
such as a crossed-out room. Scale defaults to 1/4" = 1'-0" (18 points per foot).
"""
import argparse
import json
import sys
import time
from collections import defaultdict

import pymupdf
import shapely
from shapely.geometry import MultiPoint, Point, Polygon, box
from shapely.ops import unary_union
from shapely.strtree import STRtree

from takeoff_common import clean_segments, draw_polygons, extract_vectors, polygonize_segments, ring_coords

PARAMS = {
    "min_face": 0.5,        # square units: smaller faces are slivers
    "min_hole": 1.25,       # square units: smaller holes are hatch, fixtures or text, not openings
    "whole_dots": 4, "whole_density": 2.0,     # dots, and dots per 1,000 pt^2, to take a face whole
    "part_dots": 8, "part_density": 0.4,       # a leaked face: clip it to the hull of its dots instead
    "hull_pad": 6.0,        # points around the dot hull, about half the dot spacing
    "hull_ratio": 0.35,     # shapely concave_hull tightness
    "simplify": 1.5,        # points
    "cell": 24.0,           # dot-cluster grid cell, points
    "max_density": 200.0,   # dots per 1,000 pt^2 above which dots are artwork (logos), not hatch
    "pad": 240.0,           # points of linework kept around each dot cluster (~13 ft at 1/4" scale)
}


def grid_groups(indices, pts, cell):
    """Groups of point indices whose grid cells lie within two cells of each other."""
    cells = defaultdict(list)
    for i in indices:
        cells[(int(pts[i][0] // cell), int(pts[i][1] // cell))].append(i)
    seen, groups = set(), []
    for start in cells:
        if start in seen:
            continue
        seen.add(start)
        queue, members = [start], []
        while queue:
            cx, cy = queue.pop()
            members.extend(cells[(cx, cy)])
            for dy in range(-2, 3):
                for dx in range(-2, 3):
                    nk = (cx + dx, cy + dy)
                    if nk in cells and nk not in seen:
                        seen.add(nk)
                        queue.append(nk)
        groups.append(members)
    return groups


def cluster_dots(pts, p):
    """Working boxes around hatch clusters; artwork-density dots are dropped with a margin."""
    cell = p["cell"]
    cells = defaultdict(list)
    for i, (x, y) in enumerate(pts):
        cells[(int(x // cell), int(y // cell))].append(i)
    max_per_cell = p["max_density"] * cell * cell / 1000
    poison = set()
    for (cx, cy), members in cells.items():
        if len(members) > max_per_cell:
            for dy in range(-2, 3):
                for dx in range(-2, 3):
                    poison.add((cx + dx, cy + dy))
    kept, dropped = [], 0
    for k, members in cells.items():
        if k in poison:
            dropped += len(members)
        else:
            kept.extend(members)
    clusters = []
    for members in grid_groups(kept, pts, cell):
        if len(members) < p["whole_dots"]:
            dropped += len(members)
            continue
        xs = [pts[i][0] for i in members]
        ys = [pts[i][1] for i in members]
        clusters.append((members, [min(xs) - p["pad"], min(ys) - p["pad"], max(xs) + p["pad"], max(ys) + p["pad"]]))
    boxes = []
    for members, b in clusters:
        cur = (members, b)
        while True:
            hit = next((i for i, (_, o) in enumerate(boxes)
                        if o[0] <= cur[1][2] and cur[1][0] <= o[2] and o[1] <= cur[1][3] and cur[1][1] <= o[3]), None)
            if hit is None:
                break
            om, ob = boxes.pop(hit)
            cur = (om + cur[0], [min(ob[0], cur[1][0]), min(ob[1], cur[1][1]), max(ob[2], cur[1][2]), max(ob[3], cur[1][3])])
        boxes.append(cur)
    return boxes, dropped


def detect(segs, dots, ppu, p=PARAMS, excludes=()):
    """Stucco regions from linework segments and hatch dots. Returns (regions, whole, partial, stats)."""
    t0 = time.time()
    sq = ppu * ppu
    min_face, min_hole = p["min_face"] * sq, p["min_hole"] * sq
    segs = clean_segments(segs)
    pts = [d for d in dots if not any(Point(d).within(z) for z in excludes)]
    boxes, dropped = cluster_dots(pts, p)
    whole, partial, regions = [], [], []
    faces_total = 0
    for members, b in boxes:
        faces = polygonize_segments(segs, clip=b, mode="touch", min_area=min_face)
        faces_total += len(faces)
        box_pts = [Point(pts[i]) for i in members]
        tree = STRtree(box_pts)
        in_face = set()
        w_box, p_box = [], []
        for f in faces:
            if any(f.centroid.within(z) for z in excludes):
                continue
            inside = tree.query(f, predicate="contains")
            in_face.update(tree.query(f, predicate="intersects").tolist())
            n = len(inside)
            if n == 0:
                continue
            dens = n / (f.area / 1000)
            if n >= p["whole_dots"] and dens >= p["whole_density"]:
                w_box.append(f)
            elif n >= p["part_dots"] and dens >= p["part_density"]:
                hull = shapely.concave_hull(MultiPoint([box_pts[i] for i in inside]), ratio=p["hull_ratio"])
                clipped = hull.buffer(p["hull_pad"]).intersection(f)
                if not clipped.is_empty:
                    p_box.append(clipped)
        # hatch that no face encloses (an open outline): hull of each dot group
        orphans = [i for i in range(len(box_pts)) if i not in in_face]
        if len(orphans) >= p["part_dots"]:
            for group in grid_groups(orphans, [(q.x, q.y) for q in box_pts], p["cell"]):
                if len(group) < p["part_dots"]:
                    continue
                hull = shapely.concave_hull(MultiPoint([box_pts[i] for i in group]), ratio=p["hull_ratio"])
                if hull.area < min_face or len(group) / (hull.area / 1000) < p["part_density"]:
                    continue
                p_box.append(hull.buffer(p["hull_pad"]))
        chosen = w_box + p_box
        if not chosen:
            continue
        try:
            merged = unary_union(chosen)
            polys = list(merged.geoms) if hasattr(merged, "geoms") else [merged]
        except Exception as e:                       # noqa: BLE001
            print(f"  merge failed, regions reported unmerged: {e}", file=sys.stderr)
            polys = [g for c in chosen for g in (c.geoms if hasattr(c, "geoms") else [c])]
        for g in polys:
            if not isinstance(g, Polygon) or g.area < min_face:
                continue
            shell = g.simplify(p["simplify"], preserve_topology=True)
            if not isinstance(shell, Polygon) or shell.is_empty:
                shell = g
            holes = [Polygon(h) for h in shell.interiors if Polygon(h).area >= min_hole]
            gross = Polygon(shell.exterior).area
            regions.append({
                "gross_sqft": round(gross / sq, 1),
                "net_sqft": round((gross - sum(h.area for h in holes)) / sq, 1),
                "openings_sqft": [round(h.area / sq, 1) for h in holes],
                "centroid": [round(g.centroid.x), round(g.centroid.y)],
                "exterior": ring_coords(shell.exterior),
                "holes": [ring_coords(h.exterior) for h in holes],
                "clipped": any(g.intersects(c) for c in p_box) and not any(g.within(w.buffer(0.5)) for w in w_box),
            })
        whole += w_box
        partial += p_box
    stats = {"dots": len(pts), "dots_dropped": dropped, "clusters": len(boxes), "faces": faces_total,
             "seconds": round(time.time() - t0, 1)}
    return regions, whole, partial, stats


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("pdf")
    ap.add_argument("--page", type=int, default=1)
    ap.add_argument("--out", required=True, help="output prefix")
    ap.add_argument("--zone", action="append", default=[], help='"name:x0,y0,x1,y1" label for regions by centroid')
    ap.add_argument("--exclude", action="append", default=[], help="x0,y0,x1,y1 box to ignore (e.g. a crossed-out area)")
    ap.add_argument("--xmax", type=float, help="ignore everything right of this x (only needed if a title block is hatched)")
    ap.add_argument("--pt-per-ft", type=float, default=18.0, help='18 for 1/4" = 1\'-0", 9 for 1/8"')
    ap.add_argument("--overlay-dpi", type=int, default=60)
    args = ap.parse_args()

    sqft = args.pt_per_ft ** 2
    zones = []
    for z in args.zone:
        name, coords = z.split(":")
        zones.append((name, box(*map(float, coords.split(",")))))
    excludes = [box(*map(float, e.split(","))) for e in args.exclude]
    if args.xmax:
        doc_h = 1e6
        excludes.append(box(args.xmax, -doc_h, 1e6, doc_h))

    doc = pymupdf.open(args.pdf)
    page = doc[args.page - 1]
    t = time.time()
    segs, dots = extract_vectors(page)
    print(f"  extracted {len(segs)} segments, {len(dots)} hatch dots in {time.time() - t:.0f}s", file=sys.stderr)
    if args.xmax:
        segs = [s for s in segs if s[0] <= args.xmax and s[2] <= args.xmax]
    regions, whole, partial, stats = detect(segs, dots, args.pt_per_ft, excludes=excludes)
    print(f"  {stats['dots']} dots ({stats['dots_dropped']} dropped as artwork or strays), {stats['clusters']} clusters, "
          f"{stats['faces']} faces, {stats['seconds']}s", file=sys.stderr)
    for r in regions:
        r["zone"] = next((name for name, b in zones if Point(*r["centroid"]).within(b)), "unzoned")
    regions.sort(key=lambda r: (r["zone"], -r["net_sqft"]))

    polys = [Polygon(r["exterior"], r["holes"]) for r in regions]
    draw_polygons(page, [p for p, r in zip(polys, regions) if not r["clipped"]], (0, 0.5, 0), (0, 0.75, 0.25), 0.35)
    draw_polygons(page, [p for p, r in zip(polys, regions) if r["clipped"]], (0.8, 0.4, 0), (1, 0.6, 0), 0.35)
    page.get_pixmap(dpi=args.overlay_dpi).save(f"{args.out}-overlay.png")

    summary = {}
    for r in regions:
        s = summary.setdefault(r["zone"], {"regions": 0, "gross_sqft": 0.0, "net_sqft": 0.0, "openings_sqft": 0.0})
        s["regions"] += 1
        s["gross_sqft"] = round(s["gross_sqft"] + r["gross_sqft"], 1)
        s["net_sqft"] = round(s["net_sqft"] + r["net_sqft"], 1)
        s["openings_sqft"] = round(s["openings_sqft"] + sum(r["openings_sqft"]), 1)
    json.dump({"pdf": args.pdf, "page": args.page, "pt_per_ft": args.pt_per_ft, "method": "hatch",
               "summary": summary, "regions": regions}, open(f"{args.out}.json", "w"), indent=1)
    for zone, s in summary.items():
        print(f"{zone}: {s['regions']} regions, gross {s['gross_sqft']} sq ft, openings {s['openings_sqft']} sq ft, net {s['net_sqft']} sq ft")
    for r in regions:
        flag = " (clipped to dots)" if r["clipped"] else ""
        print(f"   {r['zone']:<18} {r['net_sqft']:7.1f} net  gross {r['gross_sqft']:6.1f}  openings {r['openings_sqft']} at {r['centroid']}{flag}")


if __name__ == "__main__":
    main()
