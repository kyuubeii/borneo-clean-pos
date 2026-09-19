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

8. **RESOLVED — money owed to Jong.** Jong advanced **RM 3,713.20**, of which RM 45.00
   was cleared at the time and **RM 2,000.00 has been repaid** (the two payments above).
   **Still owed to Jong: RM 1,668.20.** Oscar is owed RM 193.90. These are on-account
   payments rather than settlements of specific expenses, so the Expenses page nets
   advances against repayments rather than ticking individual rows.

9. **Worker and Driver costs are lump sums per day**, not per named cleaner, so they are
   recorded as business expenses rather than staff payroll. Job-level labour costing will
   therefore read zero; day-level cost is accurate.


## Audit result — 19 Sept 2026

Checked every source row against the app: **no mismatches**.

- 39 jobs = 39 INCOME rows; 71 expenses = 71 EXPENSE rows; 2 reimbursements
- every income and expense row has a matching record on the same date
- sales RM 4,530.00, expenses RM 3,957.10, cash in RM 3,230.00 — all tie to the source
- no jobs exist on 04/09, confirming the RM 530 collected was not counted as new sales
- the RM 2,000 reimbursement is not recorded anywhere as an expense, so it is not
  double-counted, and no duplicate "Aaron" record remains
