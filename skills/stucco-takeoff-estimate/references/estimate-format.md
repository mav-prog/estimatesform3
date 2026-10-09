# The M3 estimate document and the job around it

`build_estimate.py` renders Marco's standard estimate with reportlab. This is the format it
implements; change the script if the format changes, never the other way around.

## Branding
- Crimson #A31F34 for headings, accents, the table header row and the grand total; dark
  gray #222222 body text; light tint #F5EDEE alternating table rows; thin gray grid.
- Header left: "M3" large bold crimson, "CONSTRUCTION SERVICES LLC" bold dark, contact line
  `gowithm3.com | (817) 269-0818 | mav@gowithm3.com`. Header right: "ESTIMATE", then
  `Estimate #` and `Date`. Full-width 2 pt crimson rule under the header.
- Estimate number `M3-MMDDYY-XXX`, XXX the scope code from the rate card (STC stucco, EIF
  EIFS; BRK, CMU, VEN exist for other trades). The builder derives it from the job date.
- Output file `M3_Estimate_<Client>_<Scope>.pdf`.

## Sections, in order
1. PREPARED FOR / PREPARED BY, two columns. For: contact name bold, company, email, phone,
   `Project:` line, `Scope:` one-line summary. By: Marco Vazquez, M3 Construction
   Services LLC, mav@gowithm3.com, (817) 269-0818.
2. Estimate Details table: Description | Qty | Unit Price | Total. Descriptions are the rate
   card's description plus the line's `detail` sentence(s) with the specifics (dimensions,
   what was counted, which sheets). Repeated codes print "As specified above." Phases get a
   header row and a subtotal row each. Owner-furnished materials are noted in the line and
   quantified in a gray footnote. Grand Total bold with the amount in crimson.
3. Scope of Work: "M3 Construction Services LLC will furnish all labor, equipment, and
   materials (exceptions noted) to complete the following:" then numbered bold subsections
   with bullets (means, methods, materials, spacing, standards) from the card.
4. Exclusions: one prose paragraph (card paragraph plus the job's `exclusions_extra`).
5. Payment Terms: "To be discussed and agreed upon prior to project commencement. Estimate
   valid for 30 days." unless the job overrides it.
6. Acceptance: authorization sentence and three signature lines: Signature | Print Name | Date.

Never use an em dash anywhere in anything written for Marco (estimates, emails, notes, records).

## Working rules
- Do the quantity takeoff with the scripts and verify totals with assertions before
  rendering (the builder asserts the grand total equals the sum of rounded lines).
- Price at current DFW market rates unless Marco gives numbers; he reviews before sending.
- Sanity-check construction details on the drawings and flag anything odd (an unusual
  system in the wall section, a substrate the card does not cover).
- Present the PDF when done (send the file), with the report described in SKILL.md.

## After Marco approves: filing in M3 Records (on his Mac)
The `M3 Records` folder on Marco's Desktop is the system of record. Every estimate is filed
there, every time, without being asked:
```
M3 Records/
  INDEX.md  AI_INSTRUCTIONS.md  README.md
  clients/firstname-lastname.md
  estimates/YYYY-MM-DD_M3-MMDDYY-XXX_client-name.md  (+ same-name .pdf)
  invoices/YYYY-MM-DD_INV-MMDDYY-XXX_client-name.md  (+ same-name .pdf)
  templates/
```
1. Check INDEX.md and clients/; reuse the client file or create it from templates/client-template.md.
2. Write the estimate file from templates/estimate-template.md: client link, project, date,
   status (Draft, Sent, Accepted, Declined, Expired), total, PDF name, rates, area or phase
   totals, every line item, scope, exclusions, payment terms, a dated history line.
3. Save the PDF next to it with the same base name.
4. Update the client file's Estimates table and INDEX.md's Clients (if new) and Estimates tables.
5. On every status change, update the estimate file, client file and INDEX.md row.
6. Invoices follow the same pattern in invoices/ with Related estimate, Due date, Paid to date, Balance.

## HubSpot
Make sure the client exists as a contact (search first, create if missing). Attach the
estimate PDF to the contact as a note; the connector cannot upload files, so it is done in
the browser on Marco's machine (open the contact, Note, Attach file, set the PDF on the file
input, type a short note with the estimate number and total, Create note, verify it shows).
Emailing the estimate: draft first, show Marco, send only after he says send, PDF attached.

## Common clients
Hasen Inc. (spoken "Hacen"; haseninc.com): Scott Zell, szell@haseninc.com, (214) 934-9314;
project coordinator Celissa Wilson, cwilson@haseninc.com. Builders and homeowners otherwise;
the client block uses whatever contact details Marco provides, and the project line carries
the job address, not the client's office address.
