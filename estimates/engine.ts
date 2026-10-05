// Pricing engine for M3 estimates: the TypeScript twin of estimates/build_estimate.py.
// A rate card holds prices and language; a job holds the client and the quantities.
import type { TakeoffItem } from '../types';

export type Rounding = 'ceil' | 'none';

export interface RateItem {
  name: string;
  description: string;
  unit: string;
  unit_price?: number | null;   // null: priced per job, the line must carry its own price
  included_in?: string;         // not priced; reported as included in the parent line
  percent_of?: string;          // priced as a share of the lines with that code
  percent?: number;
}

export interface RateCard {
  trade: string;
  scope_code: string;
  status?: string;
  rounding: Record<string, Rounding>;
  items: Record<string, RateItem>;
  takeoff_map: { match: string; code: string }[];
  scope_intro_exceptions?: string;
  scope_sections: { title: string; bullets: string[] }[];
  exclusions: string;
  payment_terms: string;
}

export interface JobLine {
  code: string;
  qty: number;
  detail?: string;
  source?: string;
  unit_price?: number | null;
}

export interface JobClient { name: string; company?: string; email?: string; phone?: string; }

export interface Job {
  date: string;                 // ISO yyyy-mm-dd
  estimate_number?: string;
  client: JobClient;
  project: string;
  scope_summary: string;
  lines: JobLine[];
  owner_furnished_note?: string;
  exclusions_extra?: string;
  payment_terms?: string;
  scope_intro_exceptions?: string;
}

export interface PricedLine {
  code: string; name: string; description: string; unit: string;
  rawQty: number; qty: number; unitPrice: number; total: number;
  detail: string; source: string; percentOf?: string; percent?: number;
}

export interface IncludedLine {
  code: string; name: string; unit: string; rawQty: number; qty: number;
  parent: string; parentCode: string; detail: string; source: string;
}

export interface Pricing { priced: PricedLine[]; included: IncludedLine[]; grand: number; }

const UNIT_ALIASES: Record<string, string> = {
  'sq ft': 'sq ft', sqft: 'sq ft', sf: 'sq ft', ft: 'ft', lf: 'ft', ea: 'EA', each: 'EA', ls: 'LS',
};

export const normUnit = (u: string): string => UNIT_ALIASES[String(u).trim().toLowerCase()] ?? String(u).trim();
export const round2 = (x: number): number => Math.round(x * 100 + 1e-9) / 100;

export function roundQty(qty: number, unit: string, rule: Rounding | undefined): number {
  if (rule === 'ceil') return Math.ceil(qty - 1e-9);
  if (rule === 'none') return qty;
  throw new Error(`No rounding rule for unit "${unit}"`);
}

export const money = (x: number): string =>
  '$' + x.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

export const fmtQty = (q: number, unit: string): string =>
  (Number.isInteger(q) ? q.toLocaleString('en-US') : q.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })) + ' ' + unit;

/** The rate line a takeoff item label maps to, by the rate card's takeoff_map, or null. */
export function mapTakeoffLabel(label: string, rates: RateCard): string | null {
  for (const m of rates.takeoff_map) {
    if (new RegExp(m.match, 'i').test(label)) return m.code;
  }
  return null;
}

export function linesFromTakeoff(items: TakeoffItem[], rates: RateCard): { lines: JobLine[]; unmapped: string[] } {
  const lines: JobLine[] = [];
  const unmapped: string[] = [];
  for (const it of items) {
    const code = mapTakeoffLabel(it.label, rates);
    if (!code) { unmapped.push(it.label); continue; }
    lines.push({ code, qty: it.totalValue, source: `ProTakeoff item '${it.label}'`, detail: `Takeoff item: ${it.label}.` });
  }
  return { lines, unmapped };
}

/** Problems that would stop pricing, as messages for the user. */
export function pricingProblems(lines: JobLine[], rates: RateCard): string[] {
  const out: string[] = [];
  const codes = new Set(lines.map((l) => l.code));
  for (const ln of lines) {
    const rate = rates.items[ln.code];
    if (!rate) { out.push(`Unknown rate line "${ln.code}".`); continue; }
    if (!(ln.qty > 0)) out.push(`${rate.name}: quantity must be greater than zero.`);
    if (rate.included_in && !codes.has(rate.included_in)) out.push(`${rate.name} is included in ${rates.items[rate.included_in]?.name ?? rate.included_in}, which is not on this estimate.`);
    if (!rate.included_in && !rate.percent_of && (ln.unit_price ?? rate.unit_price) == null) out.push(`${rate.name} is priced per job: enter its amount.`);
    if (rate.percent_of && !codes.has(rate.percent_of)) out.push(`${rate.name} is a share of ${rate.percent_of}, which is not on this estimate.`);
  }
  return out;
}

export function priceLines(lines: JobLine[], rates: RateCard): Pricing {
  const problems = pricingProblems(lines, rates);
  if (problems.length) throw new Error(problems.join(' '));
  const priced: PricedLine[] = [];
  const included: IncludedLine[] = [];
  for (const ln of lines) {
    const rate = rates.items[ln.code];
    const unit = rate.unit;
    const rawQty = Number(ln.qty);
    const qty = roundQty(rawQty, unit, rates.rounding[unit]);
    const base = { code: ln.code, name: rate.name, unit, rawQty, qty, detail: ln.detail ?? '', source: ln.source ?? '' };
    if (rate.included_in) {
      const parent = rates.items[rate.included_in];
      included.push({ ...base, parent: parent.name, parentCode: rate.included_in });
      continue;
    }
    if (rate.percent_of) {
      priced.push({ ...base, description: rate.description, unit: 'LS', rawQty: 1, qty: 1, unitPrice: 0, total: 0, percentOf: rate.percent_of, percent: Number(rate.percent) });
      continue;
    }
    const unitPrice = Number(ln.unit_price ?? rate.unit_price);
    priced.push({ ...base, description: rate.description, unitPrice, total: round2(qty * unitPrice) });
  }
  for (const p of priced) {
    if (p.percentOf) {
      const baseTotal = priced.filter((q) => q.code === p.percentOf && !q.percentOf).reduce((s, q) => s + q.total, 0);
      p.unitPrice = p.total = round2(baseTotal * (p.percent ?? 0) / 100);
    }
  }
  const grand = round2(priced.reduce((s, p) => s + p.total, 0));
  return { priced, included, grand };
}

export function estimateNumber(dateISO: string, scopeCode: string): string {
  const [y, m, d] = dateISO.split('-');
  return `M3-${m}${d}${y.slice(2)}-${scopeCode}`;
}

export function formatLongDate(dateISO: string): string {
  const [y, m, d] = dateISO.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'long', day: '2-digit', year: 'numeric' });
}
