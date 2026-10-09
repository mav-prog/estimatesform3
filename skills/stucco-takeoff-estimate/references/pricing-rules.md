# Pricing rules and the rate cards

## How a rate card works

`assets/rates/stucco.json` and `eifs.json` hold everything priced and the text that goes on
the estimate. `build_estimate.py` reads the card named by the job's `rates` field.

- `items[CODE].unit_price`: the price per unit. Job lines reference the code and give a quantity.
- `included_in`: the item is part of another item's price. It is never priced; if a job
  line uses it, its quantity is reported in a footnote under the table ("Included in the
  stucco price: 212 ft weep screed ..."). Marco's rule: casing bead, weep screed, corner
  bead, control joints, expansion joints and opening treatment are all included in the
  stucco square-foot rate. Do not price them separately.
- `percent_of` + `percent`: priced as a percentage of the priced lines with that code.
  Used for the EIFS small job premium (20 percent of the EIFS system lines).
- `unit_price: null`: priced per job; the job line must carry `unit_price`. Mobilization.
- `rounding`: quantities round up to whole units before pricing (sq ft, ft, EA); LS does not round.
- `takeoff_map`: regular expressions that map ProTakeoff item labels to codes when the
  estimate is built straight from a `.takeoff` or items file.
- `scope_sections`, `exclusions`, `payment_terms`: the text of the estimate's lower half.

## Stucco card, status as of 2026-10-09

| Code | Unit | Price | Status |
|---|---|---|---|
| STUCCO_3COAT | sq ft | $11.00 | Set by Marco on 2026-09-21 ("bump it up to $11"). Accessories included per Marco. |
| HIGH_WORK | sq ft | $1.25 | Draft placeholder; Marco said to keep a line for work above 12 ft but has not confirmed the rate. |
| FOAM_TRIM | ft | $12.00 | DFW market placeholder set 2026-10-09 for the Adams job; confirm. |
| FOAM_BAND | ft | $10.00 | Placeholder, same date; confirm. |
| KEYSTONE | EA | $45.00 | Placeholder, same date; confirm. |
| MOBILIZATION | LS | per job | Sized to the scaffolding: $1,500 for two 29 ft commercial bands; $7,500 placeholder for a three-level house plus a guest house. |
| TRIM_TOP_CASING_BEAD, WEEP_SCREED, CORNER_BEAD, CONTROL_JOINT, EXPANSION_JOINT, OPENING_TREATMENT | ft / EA | included in STUCCO_3COAT | Per Marco. |

## EIFS card

EIFS_SYSTEM $15.00/sq ft, HIGH_WORK $1.50/sq ft, SMALL_JOB_PREMIUM 20 percent of the EIFS
system lines (jobs under about 500 sq ft), CONTROL_JOINT and TERMINATION included,
MOBILIZATION per job. All of these were set as DFW market placeholders when Marco asked for
"Xactimate pricing for a DFW high-end contractor": Xactimate price lists are proprietary
and not available to the agent, which was said to Marco. He submitted that estimate as
produced; treat the numbers as his accepted placeholders until he changes them.

## Rules of thumb

- Never fabricate a price list. If asked for Xactimate, RSMeans or a competitor's numbers,
  say you cannot access them and price from the card with placeholders flagged.
- Every placeholder goes in the report to Marco with its amount and what it covers, so he
  can change it before sending. He reviews before anything leaves.
- Foam trim: 24 ft per trimmed window or door (a 5.7 x 6.7 ft ring), one keystone each,
  arched openings plus the arc. Belt and header mouldings by measured length. If the
  drawings could mean cast stone trim by others, price the foam lines anyway and say in the
  exclusions that they drop if the trim is cast stone.
- High work: the measured area above 12 ft; do not round it to "the second floor".
- Mobilization scales with scaffolding: one story, a lift; two stories with full scaffold,
  more; three levels on all sides, a lot more. Say what the figure assumes.
- Small jobs (under 500 sq ft) get the premium on EIFS; on stucco Marco has not set one;
  raise it in the report when a stucco job is that small.
- Interior stucco, stucco on sections, crossed-out rooms, porch ceilings, soffits: scope
  questions, listed in the report, not silently included or excluded.
- Keep the two implementations consistent: the ProTakeoff app has an "M3 Estimate" tab
  that reads the same rate card JSON and prices the same way (Python and TypeScript twins
  produce identical totals). A card change applies to both.

## Adding a code

Add the item to `items` with `name`, `description` (client-facing, no internal notes),
`unit`, and one of `unit_price`, `included_in` or `percent_of`. Add a `takeoff_map` match
if ProTakeoff labels should find it. Add scope text in `scope_sections` if the item
introduces work the scope of work does not already describe.
