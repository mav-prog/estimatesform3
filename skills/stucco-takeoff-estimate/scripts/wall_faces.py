#!/usr/bin/env python3
"""Polygonize one elevation into enclosed faces and draw a numbered face map.

Use this when the elevations carry no stucco hatch (plain walls with a "STUCCO" leader).
The linework inside --box is noded and polygonized; every enclosed face (wall panel, roof
plane, window, column, trim band, sky pocket) gets an id, its net area (holes subtracted)
and a label on the map. You then decide which faces are stucco wall (see
references/takeoff-method.md) and list them in a selection file for wall_takeoff.py.

    python3 wall_faces.py set.pdf --page 8 --box 340 80 2320 913 \
        --levels 312,494,522,703,731 --out out/front

--box is the building's extent on the sheet in display points: just outside the outer walls
left and right, above the ridge, and down to the first finish floor line. --levels are the
plate and floor lines (from sheet_levels.py); together with the box border they close regions
that are open on one side, such as walls behind porches and balconies, into faces.
Writes <out>.json and <out>-map.png (faces >= --label-min square units are labeled).
Add --crop x0 y0 x1 y1 --zoom 1.5 for a zoomed map of a busy area, labeled "id:area".
"""
import argparse
import colorsys
import json

import pymupdf
from PIL import Image, ImageDraw, ImageFont

from takeoff_common import extract_vectors, face_record, polygonize_segments


def face_map(page, data, out, zoom, label_min, crop=None, with_area=False):
    x0, y0, x1, y1 = crop or data["box"]
    pix = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), clip=pymupdf.Rect(x0, y0, x1, y1))
    img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples).convert("RGBA")
    ov = Image.new("RGBA", img.size, (0, 0, 0, 0))
    dr = ImageDraw.Draw(ov)
    T = lambda p: ((p[0] - x0) * zoom, (p[1] - y0) * zoom)
    try:
        font = ImageFont.truetype("DejaVuSans-Bold.ttf", 13)
    except OSError:
        font = ImageFont.load_default()
    labels = []
    for f in data["faces"]:
        if f["net"] < label_min:
            continue
        bx = f["bbox"]
        if bx[2] < x0 or bx[0] > x1 or bx[3] < y0 or bx[1] > y1:
            continue
        h = (f["id"] * 0.381) % 1.0
        r, g, b = [int(255 * c) for c in colorsys.hsv_to_rgb(h, 0.55, 0.95)]
        dr.polygon([T(p) for p in f["exterior"]], fill=(r, g, b, 110), outline=(r // 2, g // 2, b // 2, 255))
        for hole in f["holes"]:
            dr.polygon([T(p) for p in hole["ring"]], fill=(255, 255, 255, 0), outline=(0, 0, 0, 255))
        labels.append((T((f["cx"], f["cy"])), f"{f['id']}:{f['net']:.0f}" if with_area else str(f["id"])))
    img = Image.alpha_composite(img, ov)
    dr = ImageDraw.Draw(img)
    for (x, y), s in labels:
        w = dr.textlength(s, font=font)
        dr.rectangle([x - w / 2 - 3, y - 9, x + w / 2 + 3, y + 9], fill=(0, 0, 0, 200))
        dr.text((x - w / 2, y - 8), s, fill=(255, 255, 80), font=font)
    img.convert("RGB").save(out)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("pdf")
    ap.add_argument("--page", type=int, required=True)
    ap.add_argument("--box", type=float, nargs=4, required=True, metavar=("X0", "Y0", "X1", "Y1"))
    ap.add_argument("--levels", default="", help="comma-separated y values of plate and floor lines to add as closure lines")
    ap.add_argument("--vlines", default="", help="comma-separated x values of extra vertical closure lines")
    ap.add_argument("--out", required=True, help="output prefix")
    ap.add_argument("--pt-per-ft", type=float, default=18.0)
    ap.add_argument("--min-sqft", type=float, default=2.0, help="faces smaller than this are not kept")
    ap.add_argument("--label-min", type=float, default=5.0, help="faces smaller than this are drawn but not labeled")
    ap.add_argument("--zoom", type=float, default=0.75)
    ap.add_argument("--crop", type=float, nargs=4, metavar=("X0", "Y0", "X1", "Y1"), help="map only this area, labels id:area")
    args = ap.parse_args()

    sqft = args.pt_per_ft ** 2
    hl = [float(v) for v in args.levels.split(",") if v]
    vl = [float(v) for v in args.vlines.split(",") if v]
    doc = pymupdf.open(args.pdf)
    page = doc[args.page - 1]
    segs, _ = extract_vectors(page)
    faces = polygonize_segments(segs, clip=args.box, mode="box", hlines=hl, vlines=vl, min_area=args.min_sqft * sqft)
    data = {"pdf": args.pdf, "page": args.page, "box": args.box, "levels": hl, "vlines": vl, "pt_per_ft": args.pt_per_ft,
            "faces": [face_record(f, i + 1, sqft) for i, f in enumerate(faces)]}
    json.dump(data, open(f"{args.out}.json", "w"))
    face_map(page, data, f"{args.out}-map.png", args.zoom, args.label_min, crop=args.crop, with_area=bool(args.crop))
    print(f"page {args.page} box {args.box}: {len(faces)} faces >= {args.min_sqft} sq units, "
          f"total {sum(f['net'] for f in data['faces']):.0f}; map {args.out}-map.png")
    print("  " + " | ".join(f"{f['id']}:{f['net']:.0f}({f['bbox'][0]},{f['bbox'][1]}-{f['bbox'][2]},{f['bbox'][3]})"
                           for f in data["faces"] if f["net"] >= args.label_min))


if __name__ == "__main__":
    main()
