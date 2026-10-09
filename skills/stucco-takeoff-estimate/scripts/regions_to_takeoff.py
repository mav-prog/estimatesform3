#!/usr/bin/env python3
"""Turn stucco_regions.py output into a ProTakeoff project file (.takeoff).

    python3 scripts/takeoff/regions_to_takeoff.py --name "1325 Park St stucco" --out park.takeoff \
        "A3:sheet-a3.pdf:regions/A3.json" "A4:sheet-a4.pdf:regions/A4.json" "A5:sheet-a5.pdf:" ...

Each sheet argument is "label:pdf:regions.json" (regions may be empty for a sheet with
none). One AREA item is created per zone; region outlines become shapes and openings
become cutouts. Points are PDF display points, which is what ProTakeoff stores, and the
page scale is set to --pt-per-ft (18 for 1/4" = 1'-0"), so the app's values equal ours.
"""
import argparse
import datetime as dt
import json
import uuid
import zipfile
from pathlib import Path

from shapely.geometry import Polygon

COLORS = ['#ef4444', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316']


def shape(points, page_index, sqft, deduction=False):
    pts = [tuple(p) for p in points]
    if len(pts) > 1 and pts[0] == pts[-1]:
        pts = pts[:-1]
    return {
        "id": str(uuid.uuid4()),
        "pageIndex": page_index,
        "points": [{"x": round(x, 2), "y": round(y, 2)} for x, y in pts],
        "value": round(Polygon(pts).area / sqft, 4),
        "deduction": deduction,
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("sheets", nargs="+", help='"label:pdf:regions.json" in page order')
    ap.add_argument("--name", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--pt-per-ft", type=float, default=18.0)
    ap.add_argument("--rename", action="append", default=[], help='"zone=Item label" to override an item label')
    args = ap.parse_args()
    sqft = args.pt_per_ft ** 2
    renames = dict(r.split("=", 1) for r in args.rename)

    plan_sets, project_data, assets = [], {}, []
    items = {}
    for page_index, spec in enumerate(args.sheets):
        label, pdf, regions_path = spec.split(":", 2)
        pid = str(uuid.uuid4())
        plan_sets.append({"id": pid, "name": label, "pageCount": 1, "startPageIndex": page_index, "fileName": f"{pid}.pdf", "pages": [0]})
        project_data[str(page_index)] = {"scale": {"isSet": True, "pixelsPerUnit": args.pt_per_ft, "unit": "ft"}, "name": label}
        assets.append((f"assets/{pid}.pdf", Path(pdf)))
        if not regions_path:
            continue
        for r in json.load(open(regions_path))["regions"]:
            if r["net_sqft"] < 0.5:
                continue
            zone = r["zone"]
            item_label = renames.get(zone, f"Stucco - {zone}")
            it = items.setdefault(zone, {
                "id": str(uuid.uuid4()), "label": item_label, "type": "AREA", "color": COLORS[len(items) % len(COLORS)],
                "unit": "sq ft", "group": "Stucco", "shapes": [], "totalValue": 0.0, "visible": True,
            })
            it["shapes"].append(shape(r["exterior"], page_index, sqft))
            for h in r["holes"]:
                it["shapes"].append(shape(h, page_index, sqft, deduction=True))
    for it in items.values():
        it["totalValue"] = round(sum(s["value"] if not s["deduction"] else -s["value"] for s in it["shapes"]), 4)

    project = {
        "version": 2, "appVersion": "1.1.0", "items": list(items.values()), "projectData": project_data,
        "planSetsMeta": plan_sets, "totalPages": len(plan_sets), "projectName": args.name,
        "exportedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
    }
    with zipfile.ZipFile(args.out, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("project.json", json.dumps(project, indent=2))
        for arcname, path in assets:
            z.write(path, arcname)
    print(f"wrote {args.out}: {len(plan_sets)} pages, {len(items)} items")
    for it in items.values():
        cut = sum(1 for s in it["shapes"] if s["deduction"])
        print(f"   {it['label']:<40} {it['totalValue']:8.1f} sq ft  ({len(it['shapes']) - cut} shapes, {cut} cutouts)")


if __name__ == "__main__":
    main()
