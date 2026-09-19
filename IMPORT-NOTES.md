# Transaction import — 31/07/2026 to 17/09/2026

Imported with `npm run import:tx -- --yes` from `scripts/import-data.json`.
Re-runnable from scratch:

```
npm run reset -- --yes --all
npm run catalogue -- --yes     # starter services + expense categories
npm run import:tx -- --yes     # transactions, and customer contact details
npm run audit                  # checks the app against the log, row by row
```

## Reconciled totals

| | |
|---|---:|
| Sales (39 jobs) | RM 4,530.00 |
| Expenses (71 entries) | RM 3,957.10 |
| **Profit** | **RM 572.90** (12.6%) |
| Cash received | RM 3,230.00 |
| Still outstanding | RM 1,300.00 |
| Reimbursements to Jong (excluded from P&L) | RM 2,000.00 |

Cash held: **Oscar RM 2,470.00**, **Jong RM 760.00**.
Outstanding: Jamenlyn 505 RM 490, Shirley RM 440, Beautrix Sim 507 RM 280, Ivan tan RM 90.

## Rules applied

- **"Aaron" is Jong** — the same person, confirmed by Oscar. Merged into one record.
- The two RM 1,000 payments (27/08 and 06/09) are **reimbursements**, not capital.
  Oscar was paying Jong back for expenses Jong had advanced. They are recorded as
  reimbursement payouts, not expenses: the underlying costs were already counted when
  they were incurred, so counting the repayment again would double-count them.
  **Profit is unaffected either way — it stays RM 572.90.**
- The two RM 400 rows on 05/08 are **rent**, confirmed by Oscar, under the `Rent`
  expense category.
- The two collections on 04/09 settle earlier invoices and are **not** counted as sales.
- `paid_to` is recorded on the payment as *received by*, so cash-in-hand per person
  reconciles.
- `paid_by` on an expense marks it reimbursable to that person, unless it was `cleared`.

## Customer contact details

Phone numbers, addresses and notes come from the old app
(borneoclean.vercel.app → Customers → Edit) and live in
`scripts/customer-profiles.json`. `npm run import:customers -- --yes` applies them to
an existing database; the transaction importer applies them too, so a full rebuild
reproduces them.

They only ever fill blanks. The structured `Urban Residence, Unit 505/507` addresses
already on file are kept in preference to the old app's free text, which omits the unit.
Two customers have a map link instead of a street address (Joanne, Justin); the link is
stored as the address line under the label "Map pin". Four have no address on file
(Annabelle, Jenny ting agent, Lz, Teko) and four have no phone (Angie Ng, Annabelle,
Kristy, Vera) — the old app does not have them either.

## Judgement calls — worth a look

1. **The RM 350 collection for unit 507 balances exactly** (5 visits × RM 70), but the
   memo dates (13/08, 18/08, 20/08, 25/08, 27/08) do not match the actual sale dates
   for 507 (19/08, 25/08, 27/08, 01/09, 03/09). Applied to the five earliest 507
   invoices. The money is right; the memo dates look misremembered.

2. **Jamenlyn 505**: your 13/08 row of RM 140 appears in the old app as two separate
   RM 70 visits (14/08 and 18/08). Same money, recorded differently. Kept as the single
   RM 140 row from your log.

3. **Teko's RM 100 (01/09)** was marked `payment_status:unknown`. The old app shows it
   received on 1 Sep, so it is recorded as **paid**.

4. **Cosmetic only — which August date belongs to Judith and which to Mr Bong.**
   There are three RM 80 sales in the log (06/08, 08/08, 17/08) and the old app holds
   exactly one RM 80 visit each for Judith, Mr Bong and Edwina Song. The money agrees
   either way: RM 240 of sales, all paid, no customer balance affected. All that could
   be wrong is whether Judith's visit was on the 6th or the 8th.

5. **Apple Yong's 05/09 RM 120** is dated 8 Sep in the old app. Her total there is
   RM 240 over 2 visits, matching the 17/08 and 05/09 pair here. Amount and count
   agree; only the day differs.

6. **Your old app is behind**, which is expected. It is missing Vera (17/09, RM 200),
   Shirley's aircon (15/09, RM 360), and the 10/09 and 17/09 recurring visits. It also
   has an Edwina Song RM 80 on 21/08 that is not in your transaction log. This import
   follows **your transaction log**, not the old app.

7. **Worker and Driver costs are lump sums per day**, not per named cleaner, so they are
   recorded as business expenses rather than staff payroll. Job-level labour costing will
   therefore read zero; day-level cost is accurate.

## Resolved

- **RM 2,000 owed to Jong.** Jong advanced **RM 3,713.20**, of which RM 45.00 was
  cleared at the time and **RM 2,000.00 has been repaid**. **Still owed: RM 1,668.20.**
  Oscar is owed RM 193.90. These are on-account payments rather than settlements of
  specific expenses, so the Expenses page nets advances against repayments rather than
  ticking individual rows.
- **The two RM 400 rows are rent**, not an unknown house cost.
- **"Liberty" vs "AD"** on the 02/09 aircon job: Liberty is the *address*. The old app
  holds the customer as **AD** at "Liberty groove block 10 level 5 unit 3", which is now
  on the record.

## Audit — `npm run audit`

Checks the app against every row of the log and exits non-zero on any disagreement.
Last run 19 Sept 2026: **no mismatches**.

- 39 sales = 39 jobs; 71 expenses = 71 records; 2 reimbursements; 0 capital entries
- every sale and every expense matched one-for-one on **date and amount**, both ways
- sales RM 4,530.00, invoiced RM 4,530.00, expenses RM 3,957.10, cash in RM 3,230.00,
  outstanding RM 1,300.00
- no jobs exist on 04/09, confirming the RM 530 collected was not counted as new sales
- neither RM 1,000 repayment appears as an expense, and no duplicate "Aaron" remains
- contact details present for all 21 customers wherever the old app has them
