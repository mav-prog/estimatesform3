#!/usr/bin/env python3
"""Shared pieces for the stucco takeoff scripts.

Vector extraction from a PDF page, snap-rounded polygonization of linework into faces,
and drawing polygons back onto a page. All coordinates are PDF *display* points
(page rotation applied, origin top-left, 72 per inch), which is the space ProTakeoff
stores shapes in. At 1/4" = 1'-0" one foot is 18 points.
"""
import math

import pymupdf
import shapely
from shapely.geometry import MultiLineString, Polygon
from shapely.ops import polygonize, unary_union

GRID = 0.1          # snap-rounding grid in points: closes hairline gaps that would leak a face into its neighbor
MIN_PATH = 2.5      # paths smaller than this (points) are glyph strokes and hatch fragments, not linework
WATERMARK = 0.9     # light-gray stroke/fill color used for copyright watermarks on architectural sets


def bezier(p0, p1, p2, p3, n=6):
    out = []
    for i in range(n + 1):
        t = i / n
        u = 1 - t
        out.append((u ** 3 * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t ** 3 * p3[0],
                    u ** 3 * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t ** 3 * p3[1]))
    return out


def _is_gray(color, gray=WATERMARK):
    return color is not None and len(color) == 3 and all(abs(c - gray) < 0.02 for c in color)


def extract_vectors(page, min_path=MIN_PATH):
    """Linework segments and hatch dots of a page in display coordinates.

    Returns (segs, dots): segs is a list of (x0, y0, x1, y1), dots a list of (x, y).
    A hatch dot is a path made of a single zero-length line, which is how CAD exports
    draw stipple (sand) hatch. Watermark paths and tiny paths are dropped.
    """
    M = page.rotation_matrix

    def T(p):
        q = pymupdf.Point(p) * M
        return (q.x, q.y)

    segs, dots = [], []
    for d in page.get_drawings():
        if _is_gray(d.get("color")) or _is_gray(d.get("fill")):
            continue
        items = d["items"]
        if len(items) == 1 and items[0][0] == "l":
            a, b = T(items[0][1]), T(items[0][2])
            if math.dist(a, b) < 0.05:
                dots.append(a)
                continue
        r = d["rect"]
        if max(r.width, r.height) < min_path:
            continue
        for it in items:
            if it[0] == "l":
                pts = [T(it[1]), T(it[2])]
            elif it[0] == "re":
                rr = it[1]
                pts = [T((rr.x0, rr.y0)), T((rr.x1, rr.y0)), T((rr.x1, rr.y1)), T((rr.x0, rr.y1)), T((rr.x0, rr.y0))]
            elif it[0] == "qu":
                q = it[1]
                pts = [T(q.ul), T(q.ur), T(q.lr), T(q.ll), T(q.ul)]
            elif it[0] == "c":
                pts = [T(p) for p in bezier(it[1], it[2], it[3], it[4])]
            else:
                continue
            for i in range(len(pts) - 1):
                (x0, y0), (x1, y1) = pts[i], pts[i + 1]
                if (x0, y0) != (x1, y1):
                    segs.append((x0, y0, x1, y1))
    return segs, dots


def clean_segments(segs, grid=GRID):
    """Segments rounded to the grid, de-duplicated, zero-length ones dropped."""
    seen, out = set(), []
    for x0, y0, x1, y1 in segs:
        a = (round(x0 / grid), round(y0 / grid))
        b = (round(x1 / grid), round(y1 / grid))
        if a == b:
            continue
        if b < a:
            a, b = b, a
        if (a, b) in seen:
            continue
        seen.add((a, b))
        out.append((a[0] * grid, a[1] * grid, b[0] * grid, b[1] * grid))
    return out


def polygonize_segments(segs, clip=None, mode="touch", hlines=(), vlines=(), grid=GRID, min_area=0.0):
    """Faces (shapely Polygons, largest first) enclosed by the linework.

    clip=(x0, y0, x1, y1) limits the work to one area. mode "touch" keeps every segment
    that has an end inside the area, unchanged (used by the hatch method). mode "box"
    also clamps overhanging ends to the area and adds the area's border plus the given
    horizontal/vertical closure lines, so regions that are open on one side (porches,
    balconies) still close into faces (used by the wall-face method).
    """
    if clip:
        x0, y0, x1, y1 = clip
        lines = []
        for ax, ay, bx, by in segs:
            ina = x0 <= ax <= x1 and y0 <= ay <= y1
            inb = x0 <= bx <= x1 and y0 <= by <= y1
            if not ina and not inb:
                continue
            if mode == "box":
                ax, bx = min(max(ax, x0), x1), min(max(bx, x0), x1)
                ay, by = min(max(ay, y0), y1), min(max(by, y0), y1)
            lines.append((ax, ay, bx, by))
        if mode == "box":
            lines += [(x0, y0, x1, y0), (x1, y0, x1, y1), (x0, y1, x1, y1), (x0, y0, x0, y1)]
            lines += [(x0, y, x1, y) for y in hlines]
            lines += [(x, y0, x, y1) for x in vlines]
    else:
        lines = list(segs)
    lines = clean_segments(lines, grid)
    if not lines:
        return []
    ml = MultiLineString([((a, b), (c, d)) for a, b, c, d in lines])
    noded = unary_union(shapely.set_precision(ml, grid))
    faces = [f for f in polygonize(noded) if f.area >= min_area]
    faces.sort(key=lambda f: -f.area)
    return faces


def ring_coords(ring, nd=1):
    return [[round(x, nd), round(y, nd)] for x, y in ring.coords]


def face_record(face, idx, sqft):
    """A face as JSON: id, net and gross area in square units, centroid, bbox, rings."""
    c = face.centroid
    holes = [{"area": round(Polygon(h).area / sqft, 2), "ring": ring_coords(h)} for h in face.interiors]
    return {"id": idx, "net": round(face.area / sqft, 2), "gross": round(Polygon(face.exterior).area / sqft, 2),
            "cx": round(c.x), "cy": round(c.y), "bbox": [round(v) for v in face.bounds],
            "exterior": ring_coords(face.exterior), "holes": holes}


def polygon_from_record(rec):
    p = Polygon(rec["exterior"], [h["ring"] for h in rec["holes"]])
    return p if p.is_valid else p.buffer(0)


def draw_polygons(page, polys, color, fill, opacity=0.35, width=0.8):
    """Draw display-space polygons (holes left open, even-odd fill) on a pymupdf page."""
    inv = ~page.rotation_matrix
    sh = page.new_shape()
    drew = False
    for p in polys:
        parts = p.geoms if hasattr(p, "geoms") else [p]
        for part in parts:
            if part.is_empty or not isinstance(part, Polygon):
                continue
            sh.draw_polyline([pymupdf.Point(x, y) * inv for x, y in part.exterior.coords])
            drew = True
            for h in part.interiors:
                sh.draw_polyline([pymupdf.Point(x, y) * inv for x, y in h.coords])
    if drew:
        sh.finish(color=color, fill=fill, fill_opacity=opacity, even_odd=True, closePath=True, width=width)
        sh.commit()
    return drew


def display_rect_to_page(page, x0, y0, x1, y1):
    """A display-space rectangle as a normalized rect in the page's unrotated space (for text boxes)."""
    inv = ~page.rotation_matrix
    r = pymupdf.Rect(pymupdf.Point(x0, y0) * inv, pymupdf.Point(x1, y1) * inv)
    r.normalize()
    return r
