#!/usr/bin/env python3
"""Split stucco regions into work at or below 12 ft and work above it.

    python3 scripts/takeoff/high_work.py --out takeoff-items.json \
        regions/A3.json --floor "Front elevation:1560" --floor "Right elevation:786" ...

--floor gives each zone's finish-floor y in display points (the elevation's ground line
is close enough). Everything above finish floor + 12 ft counts as high work. Writes a
ProTakeoff-style items JSON that estimates/build_estimate.py accepts with --takeoff.
"""
import argparse
import json
from shapely.geometry import Polygon, box

HIGH_FT = 12.0


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("regions", nargs="+", help="regions JSON files from stucco_regions.py")
    ap.add_argument("--floor", action="append", default=[], help='"zone:y" finish floor y for a zone')
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    floors = {}
    for f in args.floor:
        zone, y = f.rsplit(":", 1)
        floors[zone] = float(y)

    total = high = 0.0
    per_zone = {}
    for path in args.regions:
        data = json.load(open(path))
        sqft = data["pt_per_ft"] ** 2
        for r in data["regions"]:
            poly = Polygon(r["exterior"], holes=r["holes"])
            net = poly.area
            zone = r["zone"]
            if zone not in floors:
                raise SystemExit(f"no --floor given for zone {zone!r} in {path}")
            cut_y = floors[zone] - HIGH_FT * data["pt_per_ft"]      # display y grows downward
            above = poly.intersection(box(-1e6, -1e6, 1e6, cut_y)).area
            z = per_zone.setdefault(zone, {"net_sqft": 0.0, "above_12ft_sqft": 0.0, "regions": 0})
            z["net_sqft"] += net / sqft
            z["above_12ft_sqft"] += above / sqft
            z["regions"] += 1
            total += net / sqft
            high += above / sqft
    for zone, z in per_zone.items():
        print(f"{zone:<18} {z['regions']:3d} regions  net {z['net_sqft']:8.1f} sq ft   above 12 ft {z['above_12ft_sqft']:7.1f} sq ft")
    print(f"{'TOTAL':<18}              net {total:8.1f} sq ft   above 12 ft {high:7.1f} sq ft")
    items = [
        {"label": "Stucco - all elevations", "type": "AREA", "unit": "sq ft", "totalValue": round(total, 1),
         "shapes": [], "source": "stucco_regions.py over " + ", ".join(args.regions)},
        {"label": "High work above 12 ft", "type": "AREA", "unit": "sq ft", "totalValue": round(high, 1),
         "shapes": [], "source": "high_work.py clip at finish floor + 12 ft"},
    ]
    json.dump({"items": items, "per_zone": per_zone}, open(args.out, "w"), indent=1)
    print("wrote", args.out)


if __name__ == "__main__":
    main()
