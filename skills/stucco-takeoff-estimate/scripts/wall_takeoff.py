#!/usr/bin/env python3
"""Sum the faces you selected as stucco wall, split them at 12 ft, and draw what was counted.

    python3 wall_takeoff.py selection.json --out out/takeoff.json --overlays out

selection.json (see references/selection-schema.md):
{
  "pt_per_ft": 18,
  "elevations": {
    "front": {"faces": "out/front.json", "ff1": 913,
              "ids": [5, 7, 9], "points": [[1050, 820]], "clips": [{"point": [1233, 829], "x": [891, 2054]}],
              "manual": [{"sqft": 20, "high": true, "note": "two dormer fronts"}]}
  },
  "groups": {"Main house": ["front", "left", "rear", "right"], "Detached house": ["dfront"]}
}

A face is selected by id or by any point inside it (points survive re-runs of
wall_faces.py, ids may not). A clip keeps only the part of a face (by id or point)
between two x values, for a face that merged a wall panel with porch air. "manual" adds areas the linework does
not enclose. ff1 is the first finish floor line: everything above ff1 minus 12 ft is high
work. Writes the takeoff JSON (areas and geometry per elevation) and, with --overlays, a
counted-<elevation>.png per elevation showing the counted area in green and the high part
tinted red: always look at those before pricing.
"""
import argparse
import json
import os

import pymupdf
from shapely import wkt
from shapely.geometry import MultiPolygon, Point, Polygon, box
from shapely.ops import unary_union

from takeoff_common import draw_polygons, polygon_from_record

HIGH_FT = 12.0


def select_faces(data, spec):
    faces = {f["id"]: f for f in data["faces"]}
    chosen = {}
    for i in spec.get("ids", []):
        if i not in faces:
            raise SystemExit(f"face id {i} not in {spec['faces']}")
        chosen[i] = polygon_from_record(faces[i])
    for x, y in spec.get("points", []):
        pt = Point(x, y)
        hit = next((f for f in data["faces"] if polygon_from_record(f).contains(pt)), None)
        if hit is None:
            raise SystemExit(f"no face contains point ({x}, {y}) in {spec['faces']}")
        chosen[hit["id"]] = polygon_from_record(hit)
    for k, clip in enumerate(spec.get("clips", [])):
        if "point" in clip:
            pt = Point(*clip["point"])
            rec = next((f for f in data["faces"] if polygon_from_record(f).contains(pt)), None)
            if rec is None:
                raise SystemExit(f"no face contains clip point {clip['point']} in {spec['faces']}")
        else:
            rec = faces[int(clip["id"])]
        x0, x1 = clip["x"]
        chosen[f"clip{k}"] = polygon_from_record(rec).intersection(box(x0, -1e9, x1, 1e9))
    return chosen


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("selection")
    ap.add_argument("--out", required=True, help="takeoff JSON to write")
    ap.add_argument("--overlays", help="directory for counted-<elevation>.png overlays")
    args = ap.parse_args()
    sel = json.load(open(args.selection))
    base = os.path.dirname(os.path.abspath(args.selection))
    ppu = float(sel.get("pt_per_ft", 18.0))
    sq = ppu * ppu
    result = {"pt_per_ft": ppu, "elevations": {}, "groups": sel.get("groups", {})}
    docs = {}
    for name, spec in sel["elevations"].items():
        path = spec["faces"] if os.path.isabs(spec["faces"]) else os.path.join(base, spec["faces"])
        data = json.load(open(path))
        chosen = select_faces(data, spec)
        geom = unary_union(list(chosen.values())) if chosen else Polygon()
        ff1 = float(spec["ff1"])
        total = geom.area / sq
        high = geom.intersection(box(-1e9, -1e9, 1e9, ff1 - HIGH_FT * ppu)).area / sq
        for m in spec.get("manual", []):
            total += m["sqft"]
            high += m["sqft"] if m.get("high") else 0
        result["elevations"][name] = {"total": round(total, 1), "high": round(high, 1), "pdf": data["pdf"], "page": data["page"],
                                      "box": data["box"], "ff1": ff1, "faces_selected": sorted(str(k) for k in chosen),
                                      "manual": spec.get("manual", []), "wkt": geom.wkt}
        print(f"{name:10s} wall {total:8.1f} sq ft   above 12 ft {high:7.1f}   ({len(chosen)} faces)")
        if args.overlays:
            os.makedirs(args.overlays, exist_ok=True)
            pdf_path = data["pdf"] if os.path.isabs(data["pdf"]) else os.path.join(base, data["pdf"])
            doc = docs.setdefault(pdf_path, pymupdf.open(pdf_path))
            page = doc[data["page"] - 1]
            polys = list(geom.geoms) if isinstance(geom, MultiPolygon) else [geom]
            draw_polygons(page, polys, (0, 0.35, 0), (0, 0.7, 0.2), 0.35)
            high_part = geom.intersection(box(-1e9, -1e9, 1e9, ff1 - HIGH_FT * ppu))
            draw_polygons(page, list(high_part.geoms) if hasattr(high_part, "geoms") else [high_part], None, (0.9, 0.1, 0.1), 0.25)
            x0, y0, x1, y1 = data["box"]
            zoom = 0.75 if (x1 - x0) > 1500 else 1.1
            page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), clip=pymupdf.Rect(x0, y0, x1, y1)).save(os.path.join(args.overlays, f"counted-{name}.png"))
            doc.reload_page(page) if hasattr(doc, "reload_page") else None
    for gname, members in result["groups"].items():
        gt = sum(result["elevations"][m]["total"] for m in members)
        gh = sum(result["elevations"][m]["high"] for m in members)
        print(f"{gname.upper():10s} {gt:8.1f} sq ft   above 12 ft {gh:7.1f}")
    tt = sum(e["total"] for e in result["elevations"].values())
    th = sum(e["high"] for e in result["elevations"].values())
    print(f"{'TOTAL':10s} {tt:8.1f} sq ft   above 12 ft {th:7.1f}")
    json.dump(result, open(args.out, "w"))
    print("wrote", args.out)


if __name__ == "__main__":
    main()
