// Renders the M3 Construction Services estimate PDF (the same layout as build_estimate.py).
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { Job, Pricing, RateCard } from './engine';
import { fmtQty, formatLongDate, money } from './engine';

const CRIMSON: [number, number, number] = [0xa3, 0x1f, 0x34];
const DARK: [number, number, number] = [0x22, 0x22, 0x22];
const TINT: [number, number, number] = [0xf5, 0xed, 0xee];
const GRID: [number, number, number] = [0xbb, 0xbb, 0xbb];
const GRAY: [number, number, number] = [0x66, 0x66, 0x66];

export const M3 = {
  name: 'Marco Vazquez',
  company: 'M3 Construction Services LLC',
  email: 'mav@gowithm3.com',
  phone: '(817) 269-0818',
  web: 'gowithm3.com',
};

const PAGE_W = 612, PAGE_H = 792, MARGIN = 54, BOTTOM = 50;
const W = PAGE_W - 2 * MARGIN;

interface Run { text: string; bold: boolean; }

/** Word-wrap runs of mixed bold/regular text to a width; returns lines of runs. */
function wrapRuns(doc: jsPDF, runs: Run[], maxWidth: number, fontSize: number): Run[][] {
  doc.setFontSize(fontSize);
  const lines: Run[][] = [];
  let line: Run[] = [];
  let width = 0;
  const measure = (t: string, bold: boolean) => { doc.setFont('helvetica', bold ? 'bold' : 'normal'); return doc.getTextWidth(t); };
  for (const run of runs) {
    const words = run.text.split(/(\s+)/).filter((w) => w.length);
    for (const word of words) {
      const w = measure(word, run.bold);
      if (width + w > maxWidth && line.length && !/^\s+$/.test(word)) {
        lines.push(line); line = []; width = 0;
      }
      if (/^\s+$/.test(word) && !line.length) continue;
      line.push({ text: word, bold: run.bold });
      width += w;
    }
  }
  if (line.length) lines.push(line);
  return lines;
}

function drawRuns(doc: jsPDF, lines: Run[][], x: number, y: number, fontSize: number, leading: number) {
  doc.setFontSize(fontSize);
  for (const line of lines) {
    let cx = x;
    for (const run of line) {
      doc.setFont('helvetica', run.bold ? 'bold' : 'normal');
      doc.text(run.text, cx, y);
      cx += doc.getTextWidth(run.text);
    }
    y += leading;
  }
  return y;
}

export function renderEstimatePdf(job: Job, rates: RateCard, pricing: Pricing, estNo: string, takeoffNote?: string): Uint8Array {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  doc.setProperties({ title: `${estNo} ${job.project}`, author: M3.company });
  let y = 44;

  const ensure = (needed: number) => {
    if (y + needed > PAGE_H - BOTTOM) { doc.addPage(); y = 44; }
  };
  const para = (text: string, opts: { size?: number; bold?: boolean; color?: [number, number, number]; indent?: number; after?: number; bullet?: boolean } = {}) => {
    const size = opts.size ?? 9.5, leading = size * 1.37, indent = opts.indent ?? 0;
    doc.setFont('helvetica', opts.bold ? 'bold' : 'normal'); doc.setFontSize(size); doc.setTextColor(...(opts.color ?? DARK));
    const lines: string[] = doc.splitTextToSize(text, W - indent - (opts.bullet ? 10 : 0));
    ensure(lines.length * leading + (opts.after ?? 3));
    if (opts.bullet) doc.text('•', MARGIN + indent - 10, y);
    doc.text(lines, MARGIN + indent, y);
    y += lines.length * leading + (opts.after ?? 3);
  };
  const heading = (text: string) => { ensure(30); y += 9; para(text, { size: 12, bold: true, color: CRIMSON, after: 6 }); };

  // Header
  doc.setFont('helvetica', 'bold'); doc.setFontSize(30); doc.setTextColor(...CRIMSON); doc.text('M3', MARGIN, y + 22);
  doc.setFontSize(11); doc.setTextColor(...DARK); doc.text('CONSTRUCTION SERVICES LLC', MARGIN, y + 38);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...GRAY);
  doc.text(`${M3.web} | ${M3.phone} | ${M3.email}`, MARGIN, y + 50);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(24); doc.setTextColor(...CRIMSON); doc.text('ESTIMATE', PAGE_W - MARGIN, y + 22, { align: 'right' });
  doc.setFontSize(9.5); doc.setTextColor(...DARK);
  const right = (label: string, value: string, yy: number) => {
    doc.setFont('helvetica', 'normal'); const vw = doc.getTextWidth(value);
    doc.text(value, PAGE_W - MARGIN, yy, { align: 'right' });
    doc.setFont('helvetica', 'bold'); doc.text(label, PAGE_W - MARGIN - vw - 4, yy, { align: 'right' });
  };
  right('Estimate #', estNo, y + 38); right('Date', formatLongDate(job.date), y + 51);
  y += 60;
  doc.setDrawColor(...CRIMSON); doc.setLineWidth(2); doc.line(MARGIN, y, PAGE_W - MARGIN, y); y += 18;

  // Prepared for / by
  const colW = W * 0.58, col2 = MARGIN + colW;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.setTextColor(...CRIMSON);
  doc.text('PREPARED FOR', MARGIN, y); doc.text('PREPARED BY', col2, y); y += 16;
  const c = job.client;
  const forRuns: Run[][] = [[{ text: c.name, bold: true }]];
  for (const v of [c.company, c.email, c.phone]) if (v) forRuns.push([{ text: v, bold: false }]);
  const leftLines: Run[][] = [];
  for (const r of forRuns) leftLines.push(...wrapRuns(doc, r, colW - 12, 9.5));
  leftLines.push(...wrapRuns(doc, [{ text: 'Project: ', bold: true }, { text: job.project, bold: false }], colW - 12, 9.5));
  leftLines.push(...wrapRuns(doc, [{ text: 'Scope: ', bold: true }, { text: job.scope_summary, bold: false }], colW - 12, 9.5));
  const byLines: Run[][] = [[{ text: M3.name, bold: true }], [{ text: M3.company, bold: false }], [{ text: M3.email, bold: false }], [{ text: M3.phone, bold: false }]];
  doc.setTextColor(...DARK);
  const yl = drawRuns(doc, leftLines, MARGIN, y, 9.5, 13);
  const yr = drawRuns(doc, byLines, col2, y, 9.5, 13);
  y = Math.max(yl, yr);

  // Estimate details
  heading('Estimate Details');
  const seen = new Set<string>();
  const descCol = W * 0.56;
  const rows = pricing.priced.map((p) => {
    const runs: Run[] = [{ text: `${p.name}. `, bold: true }];
    runs.push({ text: seen.has(p.code) ? 'As specified above.' : p.description, bold: false });
    seen.add(p.code);
    if (p.detail) runs.push({ text: ' ' + p.detail, bold: false });
    const lines = wrapRuns(doc, runs, descCol - 10, 9);
    return { lines, cells: [lines.map(() => ' ').join('\n'), fmtQty(p.qty, p.unit), `${money(p.unitPrice)}/${p.unit}`, money(p.total)] };
  });
  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN, right: MARGIN },
    head: [['Description', 'Qty', 'Unit Price', 'Total']],
    body: [...rows.map((r) => r.cells), ['', '', 'Grand Total', money(pricing.grand)]],
    theme: 'grid',
    styles: { font: 'helvetica', fontSize: 9, cellPadding: 5, lineColor: GRID, lineWidth: 0.4, textColor: DARK, valign: 'top' },
    headStyles: { fillColor: CRIMSON, textColor: [255, 255, 255], fontStyle: 'bold' },
    columnStyles: { 0: { cellWidth: descCol }, 1: { cellWidth: W * 0.14, halign: 'right' }, 2: { cellWidth: W * 0.15, halign: 'right' }, 3: { cellWidth: W * 0.15, halign: 'right' } },
    alternateRowStyles: { fillColor: TINT },
    didParseCell: (data) => {
      if (data.section !== 'body') return;
      const last = data.row.index === rows.length;
      if (last) {
        data.cell.styles.fillColor = [255, 255, 255];
        data.cell.styles.lineWidth = 0;
        data.cell.styles.fontStyle = 'bold';
        if (data.column.index === 3) data.cell.styles.textColor = CRIMSON;
        if (data.column.index === 2) data.cell.styles.lineWidth = { top: 0.8, right: 0, bottom: 0, left: 0 } as never;
        if (data.column.index === 3) data.cell.styles.lineWidth = { top: 0.8, right: 0, bottom: 0, left: 0 } as never;
      }
    },
    didDrawCell: (data) => {
      if (data.section !== 'body' || data.column.index !== 0 || data.row.index >= rows.length) return;
      doc.setTextColor(...DARK);
      drawRuns(doc, rows[data.row.index].lines, data.cell.x + 5, data.cell.y + 5 + 9 * 0.8, 9, 9 * 1.15);
    },
  });
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;

  const notes: string[] = [];
  if (job.owner_furnished_note) notes.push(job.owner_furnished_note);
  if (takeoffNote) notes.push(takeoffNote);
  if (pricing.included.length) {
    const parts = pricing.included.map((i) => `${fmtQty(i.qty, i.unit)} ${i.name.toLowerCase()}${i.detail ? ` (${i.detail.replace(/\.$/, '')})` : ''}`);
    notes.push(`Included in the ${pricing.included[0].parent.toLowerCase()} price: ${parts.join('; ')}.`);
  }
  const srcs = [...pricing.priced, ...pricing.included].map((p) => p.source).filter(Boolean);
  if (srcs.length) notes.push(`Quantities from takeoff: ${srcs.join('; ')}. Areas and lengths rounded up to whole units for pricing.`);
  for (const n of notes) para(n, { size: 8, color: GRAY, after: 2 });

  // Scope of work
  heading('Scope of Work');
  const exc = rates.scope_intro_exceptions || job.scope_intro_exceptions || '';
  para(`${M3.company} will furnish all labor, equipment, and materials${exc ? ` (${exc})` : ''} to complete the following:`);
  rates.scope_sections.forEach((sec, i) => {
    ensure(40);
    y += 4;
    para(`${i + 1}. ${sec.title}`, { size: 10, bold: true, after: 2 });
    for (const b of sec.bullets) para(b, { indent: 16, bullet: true, after: 1 });
  });

  heading('Exclusions');
  para(rates.exclusions + (job.exclusions_extra ? ' ' + job.exclusions_extra : ''));
  heading('Payment Terms');
  para(job.payment_terms || rates.payment_terms);
  heading('Acceptance');
  ensure(80);
  para(`By signing below, the client accepts this estimate and authorizes ${M3.company} to proceed with the work described above under the stated terms.`, { after: 30 });
  doc.setDrawColor(...DARK); doc.setLineWidth(0.8);
  const sig = [['Signature', W * 0.45], ['Print Name', W * 0.35], ['Date', W * 0.2]] as const;
  let sx = MARGIN;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...GRAY);
  for (const [label, w] of sig) { doc.line(sx, y, sx + w - 12, y); doc.text(label, sx, y + 11); sx += w; }

  // Footer on every page
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p); doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...GRAY);
    doc.text(`${M3.company}  |  ${estNo}`, MARGIN, PAGE_H - 32);
    doc.text(`Page ${p}`, PAGE_W - MARGIN, PAGE_H - 32, { align: 'right' });
  }
  return new Uint8Array(doc.output('arraybuffer'));
}
