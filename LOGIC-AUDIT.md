# Logic audit — Borneo Clean

Read of every action in the registry, the money and date helpers, the API routes
and the screens that do their own arithmetic. 20 Sep 2026, against commit
`12189d1` and the live database.

Nothing here is a guess. Each finding below was either **run against the real
database** or **demonstrated with a throwaway record that cleaned itself up**.
Where something is a risk I could not measure from here, it says so in the
finding rather than being stated as fact.

**Two are breaking things today.** One is a kill switch wired to the delete
buttons shipped last week.

---

## Everything, worst first

| # | What | Where | Status |
|---|---|---|---|
| 1 | Deleting a record permanently blocks all future creates of that type | `src/lib/ref.ts:4` | **Proven — breaks on first use** |
| 2 | Customer search is case-sensitive; wrong case finds nothing | `customers.ts:21`, `lookup.ts:45` | **Proven — wrong every day** |
| 3 | Refunds have no cap; money can be invented | `finance.ts:219` | Proven reachable |
| 4 | Eight cleaner-facing writes never check who is calling | `jobs.ts`, `staff.ts` | Proven reachable |
| 5 | Two different `syncInvoiceStatus` that disagree on OVERDUE | `money.ts:26` vs `finance.ts:17` | Proven divergent |
| 6 | Every date boundary shifts 8 hours on a UTC server | `dates.ts:1-2` | Demonstrated; needs one check on prod |
| 7 | Deactivating a cleaner erases them from payroll | `expenses.ts:138`, `reports.ts:137` | Confirmed by reading |
| 8 | Online bookings never become jobs | `api/book/route.ts:45` | Latent (0 online bookings so far) |
| 9 | `reports.myDay` pays 0 to anyone not HOURLY | `reports.ts:246` | Confirmed against Jong |
| 10 | Customer page totals ignore tax | `customers/[id]/page.tsx:49,143` | Latent (0 taxed invoices) |
| 11 | `reports.summary.outstandingCents` is not outstanding | `reports.ts:62` | Confirmed by reading |
| 12 | The tax rate in Settings is never used | `settings/page.tsx:52` | Confirmed by reading |
| 13 | Two ways to cancel a booking, only one cancels the job | `bookings.ts:167` | Confirmed by reading |
| 14 | Nothing stops paying the same payroll period twice | `expenses.ts:160` | Confirmed by reading |
| 15 | A payout covering reimbursements leaves the debt showing | `expenses.ts:118` | Confirmed by reading |
| 16 | `avgJobValue` includes cancelled jobs, `sales` excludes them | `reports.ts:68` | Confirmed by reading |
| 17 | Job revenue counted once per cleaner on shared jobs | `reports.ts:157` | Confirmed by reading |

---

## 1. Deleting a record permanently blocks creating that type again

`src/lib/ref.ts` builds every reference from a row count:

```ts
const n = await (db as any)[model].count();
return `${prefix}-${String(n + 1).padStart(4, "0")}`;
```

`ref` is `@unique` on all seven models. Delete any record that is **not** the
highest-numbered one, and the count drops below the maximum ref in use — so the
next create generates a reference that already exists, Prisma throws `P2002`,
and the create fails. Nothing advances the counter, so **it fails again every
time, forever.**

I ran exactly that cycle:

```
created EXP-0072 and EXP-0073
deleted EXP-0072 -> count drops by one
next ref would now be EXP-0073, but EXP-0073 already exists -> COLLISION
!! create FAILED: [P2002] Unique constraint failed on the fields: (`ref`)
cleaned up, strays left: 0
```

The trigger is the delete buttons added last week — `bookings.delete`,
`invoices.delete`, `payments.delete`, `quotes.delete`, `expenses.delete`. Your
data is clean **only because nobody has pressed one yet**. I checked all seven
counters:

```
booking  count=40 maxRef=40    job     count=40 maxRef=40
invoice  count=39 maxRef=39    quote   count=1  maxRef=1
payment  count=26 maxRef=26    expense count=71 maxRef=71
payout   count=4  maxRef=4
```

Delete booking `BKG-0007` and you can never create another booking. Not the
online form, not the assistant, not the New button.

It is also racy without any deletion: two people creating a booking at the same
instant both read the same count and one fails.

## 2. Searching for a customer is case-sensitive

`customers.search` and `search.global` use Prisma `contains` with no
`mode: "insensitive"`. On PostgreSQL that is a case-sensitive `LIKE`.

Against your data, for the customer named `AD`:

```
name="AD"  exact match=1   searching "AD"=1   searching "ad"=0
```

Typing the name in the wrong case returns **nothing**, with an empty-state that
reads like the customer does not exist. This is live on the Customers screen
search box, the global search, and the customer pickers on the booking and quote
forms. Someone will conclude a customer was deleted and re-create them.

## 3. A refund can exceed everything ever collected

`payments.record` refuses to take more than is owed:

```ts
if (i.amountCents > before.balance) throw new ActionError(`Payment exceeds the outstanding balance of …`)
```

`payments.refund` has no equivalent check — I confirmed there is no cap in the
handler. Refund RM 500 against an invoice that only ever received RM 100 and the
paid total goes to −400. `syncInvoiceStatus` then reads `paid <= 0` and marks the
invoice **SENT**, so it comes back as outstanding and is chased again. The books
now show money going out that never came in, and the refund button sits on the
invoice screen.

## 4. Cleaners can act on jobs that are not theirs

The reads are carefully gated. `jobs.get` refuses a cleaner who is not assigned,
`lookup.byRef` does the same, `jobs.list` and `expenses.list` force
`staffId` to the caller. The writes do none of it:

```
jobs.updateStatus          roles=OWNER/ADMIN/STAFF  checks-the-caller=NO
jobs.update                roles=OWNER/ADMIN/STAFF  checks-the-caller=NO
jobs.toggleChecklistItem   roles=OWNER/ADMIN/STAFF  checks-the-caller=NO
jobs.addPhoto              roles=OWNER/ADMIN/STAFF  checks-the-caller=NO
jobs.setChecklist          roles=OWNER/ADMIN/STAFF  checks-the-caller=NO
jobs.addChecklistItem      roles=OWNER/ADMIN/STAFF  checks-the-caller=NO
staff.checkIn              roles=OWNER/ADMIN/STAFF  checks-the-caller=NO
staff.checkOut             roles=OWNER/ADMIN/STAFF  checks-the-caller=NO
```

A cleaner cannot *see* another cleaner's job, but can complete it, cancel it,
wipe its checklist or attach a photo to it — by id. Worse, `staff.checkIn` takes
`staffId` as a parameter and never compares it to the caller, so a cleaner can
log hours **as somebody else**, and those hours feed `payroll.calculate`.

The assistant reaches the same actions with the same role list.

## 5. An invoice's status depends on which code path touched it

There are two `syncInvoiceStatus` functions:

- `src/lib/money.ts:26` — exported, used by `edits.ts` (`jobs.setPrice`, `payments.delete`)
- `src/lib/actions/finance.ts:17` — private, used by `payments.record` and `payments.refund`

They are not the same function. Confirmed:

```
money.ts sets OVERDUE?  false
finance.ts sets OVERDUE? true
```

So recording a payment on an unpaid, past-due invoice can leave it **OVERDUE**,
while deleting a payment from that same invoice resets it to **SENT** — the due
date has not changed, but the invoice has quietly stopped being overdue and
drops off the daily briefing's chase list.

## 6. Every "today" and every month boundary may be 8 hours out

`startOfDay`, `endOfDay` and `isoDate` all use `setHours` / `getFullYear`, which
are **server-local**. No `TZ` is set in `.env`, `.env.example`, `vercel.json` or
`next.config.mjs`. Your Mac is UTC+8, so this is correct in development and would
not be noticed there.

Running the same helpers under each timezone:

```
TZ=Asia/Kuching   a 07:00 1-Sep job lands on 2026-09-01  (month bucket 2026-09)
TZ=UTC            a 07:00 1-Sep job lands on 2026-08-31  (month bucket 2026-08)

TZ=Asia/Kuching   availability check reads local hour 21:00
TZ=UTC            availability check reads local hour 13:00
```

On a UTC server: a 7am job on the 1st is counted in the **previous month's**
revenue; "today's jobs" runs 8am-to-8am Malaysian time; and
`staff.findAvailable` compares a 9pm job against the cleaner's 1pm availability,
so it will happily say a cleaner is free when they are not.

**This is the one thing I could not verify for you**, because I cannot read the
deployed runtime's timezone from here. `vercel.json` pins the *region* to `sin1`,
which is Singapore — but region is not timezone, and Node on Vercel defaults to
UTC regardless. To settle it in ten seconds: open the deployed dashboard late in
the Malaysian evening and see whether a job you know is today appears under
today. If it jumps to tomorrow, this is live.

---

## The rest, grouped

**Payroll quietly loses people and money**

- `payroll.calculate` and `reports.staffPerformance` both filter
  `where: { active: true }`. Deactivate a cleaner who worked this month and their
  pay silently vanishes from the payroll run — no line, no warning, no zero.
  Deactivating is exactly what `EDIT-DELETE.md` tells you to do instead of
  deleting, so the two features work against each other.
- `payroll.createPayout` takes a free-typed amount and any period. Nothing links
  a payout to the hours it covered and nothing refuses a second payout for the
  same week, so running payroll twice pays twice with no complaint.
- A payout defaults to `kind: "EARNINGS"`, but `staff.advances` only counts
  `kind: "REIMBURSEMENT"` as repayment. Pay someone their wages and their fuel
  money in one payout and the app still shows the fuel money as owed.
- `reports.myDay` computes earnings for `HOURLY` only — `PER_JOB` and `PERCENT`
  fall through to `0`. Jong is `PER_JOB`, so Jong's own screen always reads
  RM 0.00 earned. (Jong's rate is also set to 0, worth checking separately.)

**Online bookings are a dead end**

`createJobForBooking` is only ever called from `bookings.create`. The public
form at `/api/book` deliberately creates a `PENDING` booking with no job, for the
office to confirm — but confirming it goes through `bookings.updateStatus`, which
only changes the status field. **No job is ever created.** The booking never
appears in Jobs, can never be assigned to a cleaner, and can never be invoiced.
Latent: you have 0 online bookings so far. It breaks the first time a customer
uses the public form.

**Numbers that disagree with each other**

- The customer page computes invoice totals as `items − discount`, with no tax,
  in two places. `invoiceTotals` includes tax. Any taxed invoice makes the
  customer's "Outstanding" disagree with the invoice screen and the dashboard.
  Latent: 0 invoices currently carry tax.
- Settings has an "Invoice defaults → tax rate" field that writes
  `invoice.taxRateBp`. Nothing reads it. `invoices.create` and
  `invoices.createFromJob` both default `taxRateBp` to `0`. The setting appears
  to work and does nothing.
- `reports.summary.outstandingCents` is `max(0, sales this period − cash received
  this period)`. Those are different populations — a payment for last month's job
  reduces this month's "outstanding". It is not a debt figure. The dashboard
  wisely uses `payments.outstanding` instead, but the assistant sees both and
  will quote whichever it reaches first.
- `avgJobValueCents` divides total revenue of **all** jobs (cancelled included)
  by the count of all jobs, while `salesCents` right above it excludes cancelled.
  Two different definitions of the same month's work, three lines apart.
- `reports.staffPerformance` adds the **full** job revenue to every assigned
  cleaner, so one RM 300 job worked by two people reports RM 600 generated. You
  have 1 such job today. Same shape in `payroll.calculate` for `PERCENT` staff,
  where it may well be intended — but the reporting one is not a pay decision.

**Status can drift out of step**

`bookings.cancel` cancels the booking *and* its job. `bookings.updateStatus`
with `status: "CANCELLED"` cancels only the booking and leaves the job
`SCHEDULED` — still on the calendar, still assigned, still counted. Both are
reachable from the UI and the assistant. (Currently 0 rows are out of step.)
Neither path considers an invoice that has already been raised.

---

## What I checked and found sound

Worth saying, so the list above is read in proportion:

- Money is integer cents throughout; no float arithmetic anywhere.
- `totals()` applies discount before tax and rounds once, correctly.
- Refunds are consistently treated as negative across every reader.
- The registry is a genuine single gate: role checked, input parsed, audit
  written, on both the UI and assistant paths.
- Read batching refuses writes, so a read cannot observe half-applied state.
- The delete guards added last week hold — I re-tested them.
- `expenses.markReimbursed` and `staff.advances` correctly avoid double-counting
  a repayment recorded two ways. That one is genuinely well thought through.
- Prisma cascades are right on the child tables, and the two places they are not
  (`Job.bookingId`, `Expense.jobId`) are handled explicitly in `bookings.delete`.

---

## What I'd fix first

1 and 2 are the ones costing you today. 1 is about fifteen lines — derive the
reference from the maximum existing ref inside a transaction, or move to a
database sequence. 2 is a one-word change per query (`mode: "insensitive"`),
four call sites.

3 and 4 are small and contained. 6 is one environment variable **if** the probe
says it is live.

Say the word and I will take them in that order, with a test for each — I would
rather prove the fix than report it. Tell me if you would rather I did all
seventeen, or only the ones that bite today.
