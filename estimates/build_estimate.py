#!/usr/bin/env python3
"""Build an M3 Construction Services estimate PDF in the standard format.

    python3 estimates/build_estimate.py --job estimates/jobs/<job>.json
    python3 estimates/build_estimate.py --job <job>.json --takeoff <project.takeoff | items.json>

The job file names the client, project and (optionally) the priced lines. When a
takeoff file is given, lines are generated from its items: each item label is
matched against the rate card's takeoff_map and priced from the rate card, so the
same takeoff always yields the same estimate. Totals are asserted before rendering.
"""
import argparse
import datetime as dt
import io
import json
import math
import re
import sys
import zipfile
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_RIGHT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import (HRFlowable, KeepTogether, Paragraph, SimpleDocTemplate, Spacer, Table,
                                TableStyle)

ROOT = Path(__file__).resolve().parent
CRIMSON = colors.HexColor("#A31F34")
DARK = colors.HexColor("#222222")
TINT = colors.HexColor("#F5EDEE")
GRID = colors.HexColor("#BBBBBB")
GRAY = colors.HexColor("#666666")

M3 = {
    "name": "Marco Vazquez",
    "company": "M3 Construction Services LLC",
    "email": "mav@gowithm3.com",
    "phone": "(817) 269-0818",
    "web": "gowithm3.com",
}

UNIT_ALIASES = {"sq ft": "sq ft", "sqft": "sq ft", "sf": "sq ft", "ft": "ft", "lf": "ft", "ea": "EA", "each": "EA", "ls": "LS"}


def norm_unit(u):
    return UNIT_ALIASES.get(str(u).strip().lower(), str(u).strip())


def round_qty(qty, unit, rule):
    if rule == "ceil":
        return float(math.ceil(qty - 1e-9))
    if rule == "none":
        return float(qty)
    raise ValueError(f"unknown rounding rule {rule!r} for {unit}")


def money(x):
    return f"${x:,.2f}"


def fmt_qty(q, unit):
    return f"{q:,.0f} {unit}" if float(q).is_integer() else f"{q:,.2f} {unit}"


def esc(s):
    return str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def load_takeoff_items(path):
    """Items from a ProTakeoff .takeoff export (zip with project.json) or a JSON file."""
    p = Path(path)
    if zipfile.is_zipfile(p):
        with zipfile.ZipFile(p) as z:
            data = json.loads(z.read("project.json"))
        return data.get("items", [])
    data = json.loads(p.read_text())
    if isinstance(data, list):
        return data
    return data.get("items", [])


def lines_from_takeoff(items, rates):
    lines, unmapped = [], []
    for it in items:
        label = str(it.get("label", ""))
        code = next((m["code"] for m in rates["takeoff_map"] if re.search(m["match"], label, re.I)), None)
        if code is None:
            unmapped.append(label)
            continue
        qty = float(it.get("totalValue", 0))
        unit = norm_unit(it.get("unit", rates["items"][code]["unit"]))
        if unit != rates["items"][code]["unit"]:
            raise SystemExit(f"unit mismatch for {label!r}: takeoff {unit} vs rate {rates['items'][code]['unit']}")
        lines.append({"code": code, "qty": qty, "source": f"ProTakeoff item {label!r}", "detail": f"Takeoff item: {label}."})
    return lines, unmapped


def price_lines(lines, rates):
    """Price the lines. Items whose rate says included_in are not priced; they are
    reported as quantities included in their parent line's price."""
    priced, included = [], []
    for ln in lines:
        rate = rates["items"][ln["code"]]
        unit = rate["unit"]
        raw = float(ln["qty"])
        assert raw > 0, f"non-positive quantity for {ln['code']}"
        qty = round_qty(raw, unit, rates["rounding"][unit])
        if rate.get("included_in"):
            parent = rates["items"][rate["included_in"]]
            included.append({**ln, "name": rate["name"], "unit": unit, "raw_qty": raw, "qty": qty, "parent": parent["name"], "parent_code": rate["included_in"]})
            continue
        unit_price = ln.get("unit_price", rate.get("unit_price"))
        if unit_price is None:
            raise SystemExit(f"{ln['code']} is priced per job: set unit_price on that line in the job file")
        unit_price = float(unit_price)
        assert unit_price > 0, f"non-positive unit price for {ln['code']}"
        total = round(qty * unit_price, 2)
        priced.append({**ln, "name": rate["name"], "description": rate["description"], "unit": unit,
                       "raw_qty": raw, "qty": qty, "unit_price": unit_price, "total": total})
    grand = round(sum(p["total"] for p in priced), 2)
    assert abs(grand - sum(round(p["qty"] * p["unit_price"], 2) for p in priced)) < 0.005
    priced_codes = {p["code"] for p in priced}
    for inc in included:
        assert inc["parent_code"] in priced_codes, f"{inc['code']} is included in {inc['parent_code']}, which is not on this estimate"
    return priced, included, grand


def build(job, rates, out_path, takeoff_note=None):
    date = dt.date.fromisoformat(job["date"]) if job.get("date") else dt.date.today()
    est_no = job.get("estimate_number") or f"M3-{date.strftime('%m%d%y')}-{rates['scope_code']}"
    priced, included, grand = price_lines(job["lines"], rates)

    body = ParagraphStyle("body", fontName="Helvetica", fontSize=9.5, leading=13, textColor=DARK)
    small = ParagraphStyle("small", parent=body, fontSize=8, leading=10.5, textColor=GRAY)
    h = ParagraphStyle("h", parent=body, fontName="Helvetica-Bold", fontSize=12, leading=15, textColor=CRIMSON, spaceBefore=12, spaceAfter=5)
    sub = ParagraphStyle("sub", parent=body, fontName="Helvetica-Bold", fontSize=10, leading=13, spaceBefore=6, spaceAfter=2)
    bullet = ParagraphStyle("bullet", parent=body, leftIndent=16, bulletIndent=6)
    right = ParagraphStyle("right", parent=body, alignment=TA_RIGHT)
    cell = ParagraphStyle("cell", parent=body, fontSize=9, leading=12)
    cell_r = ParagraphStyle("cell_r", parent=cell, alignment=TA_RIGHT)
    head_w = ParagraphStyle("head_w", parent=cell, fontName="Helvetica-Bold", textColor=colors.white)
    head_wr = ParagraphStyle("head_wr", parent=head_w, alignment=TA_RIGHT)
    mark = ParagraphStyle("mark", parent=body, fontName="Helvetica-Bold", fontSize=30, leading=32, textColor=CRIMSON)
    title = ParagraphStyle("title", parent=right, fontName="Helvetica-Bold", fontSize=24, leading=27, textColor=CRIMSON)

    doc = SimpleDocTemplate(str(out_path), pagesize=letter, leftMargin=0.75 * inch, rightMargin=0.75 * inch,
                            topMargin=0.6 * inch, bottomMargin=0.7 * inch, title=f"{est_no} {job['project']}",
                            author=M3["company"])
    W = letter[0] - 1.5 * inch
    story = []

    # Header
    left = [Paragraph('M3', mark),
            Paragraph('<font size="11"><b>CONSTRUCTION SERVICES LLC</b></font>', body),
            Paragraph(f"{M3['web']} | {M3['phone']} | {M3['email']}", small)]
    rgt = [Paragraph('ESTIMATE', title),
           Paragraph(f"<b>Estimate #</b> {est_no}", right),
           Paragraph(f"<b>Date</b> {date.strftime('%B %d, %Y')}", right)]
    header = Table([[left, rgt]], colWidths=[W * 0.58, W * 0.42])
    header.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0)]))
    story += [header, Spacer(1, 6), HRFlowable(width="100%", thickness=2, color=CRIMSON), Spacer(1, 10)]

    # Prepared for / by
    c = job["client"]
    for_lines = [f"<b>{esc(c.get('name', ''))}</b>"]
    for key in ("company", "email", "phone"):
        if c.get(key):
            for_lines.append(esc(c[key]))
    for_lines.append(f"<b>Project:</b> {esc(job['project'])}")
    for_lines.append(f"<b>Scope:</b> {esc(job['scope_summary'])}")
    by_lines = [f"<b>{M3['name']}</b>", M3["company"], M3["email"], M3["phone"]]
    pf = Table([[Paragraph("<b>PREPARED FOR</b>", ParagraphStyle("lab", parent=body, textColor=CRIMSON)),
                 Paragraph("<b>PREPARED BY</b>", ParagraphStyle("lab", parent=body, textColor=CRIMSON))],
                [[Paragraph(x, body) for x in for_lines], [Paragraph(x, body) for x in by_lines]]],
               colWidths=[W * 0.58, W * 0.42])
    pf.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, 0), 4)]))
    story.append(pf)

    # Estimate details
    story.append(Paragraph("Estimate Details", h))
    rows = [[Paragraph("Description", head_w), Paragraph("Qty", head_wr), Paragraph("Unit Price", head_wr), Paragraph("Total", head_wr)]]
    seen = set()
    for p in priced:
        if p["code"] in seen:
            desc = f"<b>{esc(p['name'])}.</b> As specified above."
        else:
            desc = f"<b>{esc(p['name'])}.</b> {esc(p['description'])}"
            seen.add(p["code"])
        if p.get("detail"):
            desc += f" {esc(p['detail'])}"
        rows.append([Paragraph(desc, cell), Paragraph(fmt_qty(p["qty"], p["unit"]), cell_r),
                     Paragraph(f"{money(p['unit_price'])}/{p['unit']}", cell_r), Paragraph(money(p["total"]), cell_r)])
    rows.append(["", "", Paragraph("<b>Grand Total</b>", cell_r), Paragraph(f'<b><font color="#A31F34">{money(grand)}</font></b>', cell_r)])
    t = Table(rows, colWidths=[W * 0.56, W * 0.14, W * 0.15, W * 0.15], repeatRows=1)
    style = [("BACKGROUND", (0, 0), (-1, 0), CRIMSON), ("VALIGN", (0, 0), (-1, -1), "TOP"),
             ("GRID", (0, 0), (-1, -2), 0.4, GRID), ("LINEABOVE", (2, -1), (-1, -1), 0.8, CRIMSON),
             ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5)]
    for i in range(1, len(rows) - 1):
        if i % 2 == 0:
            style.append(("BACKGROUND", (0, i), (-1, i), TINT))
    t.setStyle(TableStyle(style))
    story.append(t)
    notes = []
    if job.get("owner_furnished_note"):
        notes.append(esc(job["owner_furnished_note"]))
    if takeoff_note:
        notes.append(esc(takeoff_note))
    if included:
        parts = []
        for inc in included:
            part = f"{fmt_qty(inc['qty'], inc['unit'])} {inc['name'].lower()}"
            if inc.get("detail"):
                part += f" ({inc['detail'].rstrip('.')})"
            parts.append(part)
        notes.append(f"Included in the {esc(included[0]['parent'].lower())} price: " + "; ".join(esc(x) for x in parts) + ".")
    srcs = [p["source"] for p in priced + included if p.get("source")]
    if srcs:
        notes.append("Quantities from takeoff: " + "; ".join(esc(s) for s in srcs) + ". Areas and lengths rounded up to whole units for pricing.")
    for n in notes:
        story += [Spacer(1, 3), Paragraph(n, small)]

    # Scope of work
    story.append(Paragraph("Scope of Work", h))
    exc = rates.get("scope_intro_exceptions") or job.get("scope_intro_exceptions") or ""
    intro = f"{M3['company']} will furnish all labor, equipment, and materials{(' (' + esc(exc) + ')') if exc else ''} to complete the following:"
    story.append(Paragraph(intro, body))
    listed = {p["code"] for p in priced}
    for i, sec in enumerate(rates["scope_sections"], 1):
        block = [Paragraph(f"{i}. {esc(sec['title'])}", sub)]
        for b in sec["bullets"]:
            block.append(Paragraph(esc(b), bullet, bulletText="•"))
        story.append(KeepTogether(block))

    # Exclusions, payment, acceptance
    story.append(Paragraph("Exclusions", h))
    excl = rates["exclusions"]
    if job.get("exclusions_extra"):
        excl += " " + job["exclusions_extra"]
    story.append(Paragraph(esc(excl), body))
    story.append(Paragraph("Payment Terms", h))
    story.append(Paragraph(esc(job.get("payment_terms") or rates["payment_terms"]), body))
    story.append(Paragraph("Acceptance", h))
    acc = [Paragraph(f"By signing below, the client accepts this estimate and authorizes {M3['company']} to proceed with the work described above under the stated terms.", body),
           Spacer(1, 26)]
    sig = Table([["", "", ""], [Paragraph("Signature", small), Paragraph("Print Name", small), Paragraph("Date", small)]],
                colWidths=[W * 0.45, W * 0.35, W * 0.2], rowHeights=[4, 14])
    sig.setStyle(TableStyle([("LINEABOVE", (0, 1), (0, 1), 0.8, DARK), ("LINEABOVE", (1, 1), (1, 1), 0.8, DARK), ("LINEABOVE", (2, 1), (2, 1), 0.8, DARK),
                             ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 12)]))
    story.append(KeepTogether(acc + [sig]))

    def footer(canvas, d):
        canvas.saveState()
        canvas.setFont("Helvetica", 8)
        canvas.setFillColor(GRAY)
        canvas.drawString(0.75 * inch, 0.45 * inch, f"{M3['company']}  |  {est_no}")
        canvas.drawRightString(letter[0] - 0.75 * inch, 0.45 * inch, f"Page {d.page}")
        canvas.restoreState()

    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    return est_no, priced, included, grand


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--job", required=True, help="job JSON (client, project, lines)")
    ap.add_argument("--takeoff", help="ProTakeoff .takeoff export or items JSON; replaces the job's lines")
    ap.add_argument("--allow-unmapped", action="store_true", help="skip takeoff items that match no rate instead of failing")
    ap.add_argument("--out", help="output PDF path (default estimates/out/<job output name>)")
    args = ap.parse_args()

    job = json.loads(Path(args.job).read_text())
    rates = json.loads((ROOT / "rates" / f"{job['rates']}.json").read_text())
    takeoff_note = None
    if args.takeoff:
        items = load_takeoff_items(args.takeoff)
        lines, unmapped = lines_from_takeoff(items, rates)
        if unmapped and not args.allow_unmapped:
            raise SystemExit("takeoff items with no rate mapping (add to takeoff_map or use --allow-unmapped): " + ", ".join(repr(u) for u in unmapped))
        if unmapped:
            print("skipped unmapped items:", ", ".join(repr(u) for u in unmapped), file=sys.stderr)
        job["lines"] = lines
        takeoff_note = f"Takeoff file: {Path(args.takeoff).name}."
    if not job.get("lines"):
        raise SystemExit("no lines to price")

    out = Path(args.out) if args.out else ROOT / "out" / job.get("output", "M3_Estimate.pdf")
    out.parent.mkdir(parents=True, exist_ok=True)
    est_no, priced, included, grand = build(job, rates, out, takeoff_note)
    print(f"{est_no}  ->  {out}")
    for p in priced:
        print(f"  {p['code']:<22} {fmt_qty(p['qty'], p['unit']):>14} x {money(p['unit_price']):>10} = {money(p['total']):>12}   (takeoff {p['raw_qty']:.2f})")
    for inc in included:
        print(f"  {inc['code']:<22} {fmt_qty(inc['qty'], inc['unit']):>14}   included in {inc['parent_code']}")
    print(f"  {'GRAND TOTAL':<22} {'':>14}   {'':>10}   {money(grand):>12}")
    if "DRAFT" in rates.get("status", ""):
        print(f"NOTE: {rates['status']}", file=sys.stderr)


if __name__ == "__main__":
    main()
