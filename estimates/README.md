# M3 estimates

Everything needed to turn a ProTakeoff takeoff into an M3 Construction Services
estimate PDF in the standard format, the same way every time.

- `rates/<trade>.json` is the rate card: unit prices, the line descriptions, the
  Scope of Work sections, the standard Exclusions paragraph and payment terms.
  Prices only change here, so two estimates for the same trade always price alike.
  `takeoff_map` decides which ProTakeoff item labels feed which rate line.
- `jobs/<job>.json` names the client, project, scope summary and (optionally) the
  priced lines with their quantities.
- `build_estimate.py` renders the PDF and asserts the totals first.

```bash
# from a job file that carries its own quantities
python3 estimates/build_estimate.py --job estimates/jobs/sample-stucco-test-sheet.json

# straight from a ProTakeoff project export (.takeoff) or the web harness items.json
python3 estimates/build_estimate.py --job estimates/jobs/<job>.json --takeoff <file>
```

Output lands in `estimates/out/` (ignored by git). Estimate numbers follow
`M3-MMDDYY-<scope code>`; areas and lengths are rounded up to whole units for pricing.
The stucco rate card is marked DRAFT until Marco reviews the unit prices.
