# Transaction import — 31/07/2026 to 17/09/2026

Imported with `npm run import:tx -- --yes` from `scripts/import-data.json`.
Re-runnable: `npm run reset -- --yes && npm run import:tx -- --yes`.

## Reconciled totals

| | |
|---|---:|
| Sales (39 jobs) | RM 4,530.00 |
| Expenses (71 entries) | RM 3,957.10 |
| **Profit** | **RM 572.90** (12.6%) |
| Cash received | RM 3,230.00 |
| Still outstanding | RM 1,300.00 |
| Capital transfers (excluded from P&L) | RM 2,000.00 |

Cash held: **Oscar RM 2,470.00**, **Jong RM 760.00**.
Outstanding: Jamenlyn 505 RM 490, Shirley RM 440, Beautrix Sim 507 RM 280, Ivan tan RM 90.

## Rules applied

- Capital transfers (2 × RM 1,000 Oscar → Aaron) are in a separate `CapitalEntry`
  ledger, not income or expenses.
- The two collections on 04/09 settle earlier invoices and are **not** counted as sales.
- `paid_to` is recorded on the payment as *received by*, so cash-in-hand per person
  reconciles.
- `paid_by` on an expense marks it reimbursable to that person, unless it was `cleared`.

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

4. **The two RM 400 "House" rows (05/08)** are recorded as expenses under a new "House"
   category, per your answer. They are 20% of all expenses, so if that is wrong the
   profit figure moves a lot (it would be RM 1,372.90 without them).

5. **Customer names matched by amount and nearest date** from your old app. Three are
   less certain — check these first:
   - 06/08 RM 80 → **Judith** *(low confidence)*
   - 08/08 RM 80 → **Mr Bong** *(low confidence)* — both are RM 80 in August
   - 05/09 RM 120 → **Apple Yong** *(medium)* — old app dates it 8 Sep

6. **"Liberty" vs "AD"**: your 02/09 aircon job for RM 120 names *Liberty*; the old app
   records the same amount and service as *AD*. Imported as **AD**. If Liberty is the
   building and AD the person, this is fine — otherwise rename.

7. **Your old app is behind**, which is expected. It is missing Vera (17/09, RM 200),
   Shirley's aircon (15/09, RM 360), and the 10/09 and 17/09 recurring visits. It also
   has an Edwina Song RM 80 on 21/08 that is not in your transaction log. This import
   follows **your transaction log**, not the old app.

8. **Reimbursements owed are large**: Jong has advanced **RM 3,668.20** and Oscar
   RM 193.90 that are not marked cleared. Only the 04/08 worker and driver payments were
   flagged `cleared`. If Jong has in fact been settled since, mark those expenses
   reimbursed under Expenses.

9. **Worker and Driver costs are lump sums per day**, not per named cleaner, so they are
   recorded as business expenses rather than staff payroll. Job-level labour costing will
   therefore read zero; day-level cost is accurate.
