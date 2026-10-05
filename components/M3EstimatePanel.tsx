import React, { useEffect, useMemo, useState } from 'react';
import { FileDown, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { LazyStore } from '@tauri-apps/plugin-store';
import { save } from '@tauri-apps/plugin-dialog';
import { writeFile } from '@tauri-apps/plugin-fs';
import { TakeoffItem } from '../types';
import { useToast } from '../contexts/ToastContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DEFAULT_RATE_CARDS } from '../estimates/rates';
import { estimateNumber, fmtQty, Job, JobLine, mapTakeoffLabel, money, priceLines, pricingProblems, RateCard } from '../estimates/engine';
import { renderEstimatePdf } from '../estimates/m3pdf';

interface Props { items: TakeoffItem[]; projectName: string; }

interface LineOverride { code?: string; qty?: number; unitPrice?: number; detail?: string; }
interface ManualLine { id: string; code: string; qty: number; unitPrice?: number; detail: string; }
interface JobForm {
  rateCard: string; date: string; estimateNumber: string;
  clientName: string; clientCompany: string; clientEmail: string; clientPhone: string;
  project: string; scopeSummary: string; exclusionsExtra: string; ownerFurnished: string; paymentTerms: string;
  overrides: Record<string, LineOverride>; manual: ManualLine[];
}

const todayISO = () => new Date().toISOString().slice(0, 10);
const store = new LazyStore('m3-estimates.json');

const emptyForm = (projectName: string): JobForm => ({
  rateCard: 'stucco', date: todayISO(), estimateNumber: '',
  clientName: '', clientCompany: '', clientEmail: '', clientPhone: '',
  project: projectName, scopeSummary: '', exclusionsExtra: '', ownerFurnished: '', paymentTerms: '',
  overrides: {}, manual: [],
});

const field = 'h-8 text-sm';

const M3EstimatePanel: React.FC<Props> = ({ items, projectName }) => {
  const { addToast } = useToast();
  const [cards, setCards] = useState<Record<string, RateCard>>(DEFAULT_RATE_CARDS);
  const [form, setForm] = useState<JobForm>(() => emptyForm(projectName));
  const [loaded, setLoaded] = useState(false);
  const [showRates, setShowRates] = useState(false);
  const [busy, setBusy] = useState(false);

  // Load stored rate edits and the job form for this project.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const storedCards = await store.get<Record<string, RateCard>>('rates');
        const jobs = await store.get<Record<string, JobForm>>('jobs');
        if (!alive) return;
        if (storedCards) setCards({ ...DEFAULT_RATE_CARDS, ...storedCards });
        if (jobs && jobs[projectName]) setForm({ ...emptyForm(projectName), ...jobs[projectName] });
      } catch (e) {
        console.warn('M3 estimate settings not loaded', e);
      } finally {
        if (alive) setLoaded(true);
      }
    })();
    return () => { alive = false; };
  }, [projectName]);

  // Persist the form per project.
  useEffect(() => {
    if (!loaded) return;
    const t = setTimeout(async () => {
      try {
        const jobs = (await store.get<Record<string, JobForm>>('jobs')) ?? {};
        jobs[projectName] = form;
        await store.set('jobs', jobs); await store.save();
      } catch (e) { console.warn('M3 estimate form not saved', e); }
    }, 400);
    return () => clearTimeout(t);
  }, [form, loaded, projectName]);

  const rates = cards[form.rateCard] ?? DEFAULT_RATE_CARDS.stucco;
  const codes = Object.keys(rates.items);
  const set = <K extends keyof JobForm>(k: K, v: JobForm[K]) => setForm((f) => ({ ...f, [k]: v }));
  const setOverride = (id: string, patch: LineOverride) => setForm((f) => ({ ...f, overrides: { ...f.overrides, [id]: { ...(f.overrides[id] ?? {}), ...patch } } }));

  // Takeoff items mapped to rate lines, with the user's overrides applied.
  const itemLines = useMemo(() => items.map((it) => {
    const o = form.overrides[it.id] ?? {};
    const code = o.code !== undefined ? o.code : (mapTakeoffLabel(it.label, rates) ?? '');
    return { item: it, code, qty: o.qty ?? it.totalValue, unitPrice: o.unitPrice, detail: o.detail ?? `Takeoff item: ${it.label}.` };
  }), [items, form.overrides, rates]);

  const jobLines: JobLine[] = useMemo(() => [
    ...itemLines.filter((l) => l.code).map((l) => ({ code: l.code, qty: l.qty, unit_price: l.unitPrice, detail: l.detail, source: `ProTakeoff item '${l.item.label}'` })),
    ...form.manual.filter((m) => m.code).map((m) => ({ code: m.code, qty: m.qty, unit_price: m.unitPrice, detail: m.detail, source: '' })),
  ], [itemLines, form.manual]);

  const problems = useMemo(() => jobLines.length ? pricingProblems(jobLines, rates) : ['No priced lines yet.'], [jobLines, rates]);
  const pricing = useMemo(() => { try { return problems.length ? null : priceLines(jobLines, rates); } catch { return null; } }, [jobLines, rates, problems]);
  const estNo = form.estimateNumber || estimateNumber(form.date || todayISO(), rates.scope_code);

  const job: Job = {
    date: form.date || todayISO(), estimate_number: estNo,
    client: { name: form.clientName || 'Client to be confirmed', company: form.clientCompany, email: form.clientEmail, phone: form.clientPhone },
    project: form.project || projectName, scope_summary: form.scopeSummary, lines: jobLines,
    owner_furnished_note: form.ownerFurnished, exclusions_extra: form.exclusionsExtra, payment_terms: form.paymentTerms || undefined,
  };

  const generate = async () => {
    if (!pricing) { addToast('Fix the pricing problems first', 'error'); return; }
    setBusy(true);
    try {
      const bytes = renderEstimatePdf(job, rates, pricing, estNo);
      const client = (form.clientCompany || form.clientName || 'Client').replace(/[^a-z0-9]/gi, '');
      const name = `M3_Estimate_${client}_${rates.trade.replace(/[^a-z0-9]/gi, '')}.pdf`;
      const path = await save({ filters: [{ name: 'PDF Document', extensions: ['pdf'] }], defaultPath: name });
      if (!path) { addToast('Estimate not saved', 'info'); return; }
      await writeFile(path, bytes);
      addToast(`Estimate ${estNo} saved`, 'success');
    } catch (e) {
      console.error('Estimate export failed', e);
      addToast('Estimate export failed. See console.', 'error');
    } finally { setBusy(false); }
  };

  const updateRate = (code: string, price: number | null) => {
    const next = { ...cards, [form.rateCard]: { ...rates, items: { ...rates.items, [code]: { ...rates.items[code], unit_price: price } } } };
    setCards(next);
    store.set('rates', next).then(() => store.save()).catch((e) => console.warn('rates not saved', e));
  };
  const resetRates = () => {
    const next = { ...cards, [form.rateCard]: DEFAULT_RATE_CARDS[form.rateCard] };
    setCards(next);
    store.set('rates', next).then(() => store.save()).catch((e) => console.warn('rates not saved', e));
    addToast('Rate card reset to the shipped defaults', 'info');
  };

  const rateLabel = (code: string) => rates.items[code]?.name ?? code;
  const lineTotal = (code: string) => pricing?.priced.find((p) => p.code === code && !p.percentOf);

  return (
    <div className="space-y-6" data-m3-estimate-panel>
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <Card className="border-border shadow-sm">
          <CardContent className="p-5 space-y-3">
            <h2 className="font-semibold text-foreground">Job</h2>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label className="text-xs">Rate card</Label>
                <select aria-label="Rate card" className="w-full h-8 text-sm border border-border rounded-md bg-background px-2" value={form.rateCard} onChange={(e) => set('rateCard', e.target.value)}>
                  {Object.entries(cards).map(([id, c]) => <option key={id} value={id}>{c.trade}</option>)}
                </select>
              </div>
              <div className="space-y-1"><Label className="text-xs">Date</Label><Input className={field} type="date" value={form.date} onChange={(e) => set('date', e.target.value)} /></div>
            </div>
            <div className="space-y-1"><Label className="text-xs">Estimate # (blank for {estimateNumber(form.date || todayISO(), rates.scope_code)})</Label><Input className={field} value={form.estimateNumber} onChange={(e) => set('estimateNumber', e.target.value)} placeholder={estNo} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label className="text-xs">Client name</Label><Input className={field} value={form.clientName} onChange={(e) => set('clientName', e.target.value)} placeholder="Contact name" /></div>
              <div className="space-y-1"><Label className="text-xs">Company</Label><Input className={field} value={form.clientCompany} onChange={(e) => set('clientCompany', e.target.value)} /></div>
              <div className="space-y-1"><Label className="text-xs">Email</Label><Input className={field} value={form.clientEmail} onChange={(e) => set('clientEmail', e.target.value)} /></div>
              <div className="space-y-1"><Label className="text-xs">Phone</Label><Input className={field} value={form.clientPhone} onChange={(e) => set('clientPhone', e.target.value)} /></div>
            </div>
            <div className="space-y-1"><Label className="text-xs">Project (job address and description)</Label><Textarea className="text-sm min-h-[56px]" value={form.project} onChange={(e) => set('project', e.target.value)} /></div>
            <div className="space-y-1"><Label className="text-xs">Scope summary</Label><Textarea className="text-sm min-h-[56px]" value={form.scopeSummary} onChange={(e) => set('scopeSummary', e.target.value)} /></div>
            <div className="space-y-1"><Label className="text-xs">Extra exclusions</Label><Textarea className="text-sm min-h-[44px]" value={form.exclusionsExtra} onChange={(e) => set('exclusionsExtra', e.target.value)} /></div>
            <div className="space-y-1"><Label className="text-xs">Owner-furnished materials note</Label><Input className={field} value={form.ownerFurnished} onChange={(e) => set('ownerFurnished', e.target.value)} /></div>
            <div className="space-y-1"><Label className="text-xs">Payment terms (blank for the standard terms)</Label><Input className={field} value={form.paymentTerms} onChange={(e) => set('paymentTerms', e.target.value)} /></div>
          </CardContent>
        </Card>

        <Card className="border-border shadow-sm xl:col-span-2">
          <CardContent className="p-0">
            <div className="p-5 pb-3 flex items-center justify-between">
              <h2 className="font-semibold text-foreground">Priced lines</h2>
              <span className="text-xs text-muted-foreground">{rates.status}</span>
            </div>
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead>Takeoff item</TableHead><TableHead>Rate line</TableHead><TableHead className="w-28 text-right">Qty</TableHead><TableHead className="w-28 text-right">Unit price</TableHead><TableHead className="w-28 text-right">Total</TableHead><TableHead className="w-10"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {itemLines.map((l) => {
                  const rate = rates.items[l.code];
                  const perJob = rate && !rate.included_in && !rate.percent_of && rate.unit_price == null;
                  const priced = rate ? pricing?.priced.find((p) => p.source === `ProTakeoff item '${l.item.label}'`) : undefined;
                  return (
                    <TableRow key={l.item.id} className={!l.code ? 'bg-amber-50' : ''}>
                      <TableCell className="text-sm"><span className="inline-block w-2.5 h-2.5 rounded-full mr-2" style={{ background: l.item.color }} />{l.item.label}<div className="text-xs text-muted-foreground">{fmtQty(Math.round(l.item.totalValue * 100) / 100, l.item.unit)} measured</div></TableCell>
                      <TableCell>
                        <select aria-label={`Rate line for ${l.item.label}`} className="w-full h-8 text-sm border border-border rounded-md bg-background px-2" value={l.code} onChange={(e) => setOverride(l.item.id, { code: e.target.value })}>
                          <option value="">Not priced</option>
                          {codes.map((c) => <option key={c} value={c}>{rateLabel(c)}{rates.items[c].included_in ? ' (included)' : ''}</option>)}
                        </select>
                      </TableCell>
                      <TableCell className="text-right"><Input className="h-8 text-sm text-right" type="number" step="0.01" value={l.qty} onChange={(e) => setOverride(l.item.id, { qty: Number(e.target.value) })} /></TableCell>
                      <TableCell className="text-right text-sm">
                        {rate?.included_in ? <span className="text-muted-foreground">included</span>
                          : perJob ? <Input className="h-8 text-sm text-right" type="number" step="0.01" value={l.unitPrice ?? ''} placeholder="per job" onChange={(e) => setOverride(l.item.id, { unitPrice: e.target.value === '' ? undefined : Number(e.target.value) })} />
                          : rate ? `${money(Number(l.unitPrice ?? rate.unit_price ?? 0))}/${rate.unit}` : ''}
                      </TableCell>
                      <TableCell className="text-right text-sm font-medium">{priced ? money(priced.total) : rate?.included_in ? '' : ''}</TableCell>
                      <TableCell></TableCell>
                    </TableRow>
                  );
                })}
                {form.manual.map((m) => {
                  const rate = rates.items[m.code];
                  const perJob = rate && !rate.included_in && !rate.percent_of && rate.unit_price == null;
                  const priced = pricing?.priced.find((p) => p.code === m.code && p.detail === m.detail && p.source === '');
                  return (
                    <TableRow key={m.id}>
                      <TableCell><Input className="h-8 text-sm" value={m.detail} placeholder="Detail for this line" onChange={(e) => set('manual', form.manual.map((x) => x.id === m.id ? { ...x, detail: e.target.value } : x))} /></TableCell>
                      <TableCell>
                        <select aria-label="Rate line" className="w-full h-8 text-sm border border-border rounded-md bg-background px-2" value={m.code} onChange={(e) => set('manual', form.manual.map((x) => x.id === m.id ? { ...x, code: e.target.value } : x))}>
                          <option value="">Choose a rate line</option>
                          {codes.map((c) => <option key={c} value={c}>{rateLabel(c)}</option>)}
                        </select>
                      </TableCell>
                      <TableCell className="text-right"><Input className="h-8 text-sm text-right" type="number" step="0.01" value={m.qty} onChange={(e) => set('manual', form.manual.map((x) => x.id === m.id ? { ...x, qty: Number(e.target.value) } : x))} /></TableCell>
                      <TableCell className="text-right text-sm">
                        {rate?.percent_of ? <span className="text-muted-foreground">{rate.percent}% of {rateLabel(rate.percent_of)}</span>
                          : perJob ? <Input className="h-8 text-sm text-right" type="number" step="0.01" value={m.unitPrice ?? ''} placeholder="per job" onChange={(e) => set('manual', form.manual.map((x) => x.id === m.id ? { ...x, unitPrice: e.target.value === '' ? undefined : Number(e.target.value) } : x))} />
                          : rate?.included_in ? <span className="text-muted-foreground">included</span>
                          : rate ? `${money(Number(m.unitPrice ?? rate.unit_price ?? 0))}/${rate.unit}` : ''}
                      </TableCell>
                      <TableCell className="text-right text-sm font-medium">{priced ? money(priced.total) : ''}</TableCell>
                      <TableCell><Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" aria-label="Remove line" onClick={() => set('manual', form.manual.filter((x) => x.id !== m.id))}><Trash2 size={14} /></Button></TableCell>
                    </TableRow>
                  );
                })}
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={6}>
                    <Button variant="outline" size="sm" className="gap-2" onClick={() => set('manual', [...form.manual, { id: crypto.randomUUID(), code: '', qty: 1, detail: '' }])}><Plus size={14} /> Add a line (mobilization, high work, premiums)</Button>
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
            <div className="p-5 border-t border-border space-y-2">
              {pricing?.included.length ? (
                <p className="text-xs text-muted-foreground">Included in the {pricing.included[0].parent.toLowerCase()} price: {pricing.included.map((i) => `${fmtQty(i.qty, i.unit)} ${i.name.toLowerCase()}`).join('; ')}.</p>
              ) : null}
              {problems.map((p, i) => <p key={i} className="text-xs text-amber-700">{p}</p>)}
              <div className="flex items-center justify-between pt-2">
                <div className="text-sm text-muted-foreground">Estimate <span className="font-mono text-foreground">{estNo}</span></div>
                <div className="text-right"><div className="text-xs text-muted-foreground">Grand total</div><div className="text-2xl font-semibold" style={{ color: '#A31F34' }} data-grand-total>{pricing ? money(pricing.grand) : '—'}</div></div>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <Button variant="outline" onClick={() => setShowRates((s) => !s)}>{showRates ? 'Hide rate card' : 'Edit rate card'}</Button>
                <Button onClick={generate} disabled={!pricing || busy} className="gap-2" data-generate-estimate><FileDown size={16} /> Generate estimate PDF</Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {showRates && (
        <Card className="border-border shadow-sm">
          <CardContent className="p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div><h2 className="font-semibold text-foreground">Rate card: {rates.trade}</h2><p className="text-xs text-muted-foreground">{rates.status}</p></div>
              <Button variant="outline" size="sm" className="gap-2" onClick={resetRates}><RotateCcw size={14} /> Reset to defaults</Button>
            </div>
            <Table>
              <TableHeader><TableRow className="bg-muted/50 hover:bg-muted/50"><TableHead>Line</TableHead><TableHead className="w-24">Unit</TableHead><TableHead className="w-40 text-right">Unit price</TableHead><TableHead>Description</TableHead></TableRow></TableHeader>
              <TableBody>
                {codes.map((c) => { const r = rates.items[c]; return (
                  <TableRow key={c}>
                    <TableCell className="text-sm font-medium">{r.name}<div className="text-xs text-muted-foreground font-mono">{c}</div></TableCell>
                    <TableCell className="text-sm">{r.unit}</TableCell>
                    <TableCell className="text-right">
                      {r.included_in ? <span className="text-xs text-muted-foreground">included in {rateLabel(r.included_in)}</span>
                        : r.percent_of ? <span className="text-xs text-muted-foreground">{r.percent}% of {rateLabel(r.percent_of)}</span>
                        : <Input className="h-8 text-sm text-right" type="number" step="0.01" value={r.unit_price ?? ''} placeholder="per job" onChange={(e) => updateRate(c, e.target.value === '' ? null : Number(e.target.value))} />}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{r.description}</TableCell>
                  </TableRow>); })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default M3EstimatePanel;
