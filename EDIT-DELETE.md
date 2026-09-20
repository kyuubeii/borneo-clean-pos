# Edit & delete — what was added, and what to check

Live in production. Commits `9e6c01d` and `a98e61e`.

## The short version

Almost every action you were missing **already existed** in the registry —
`staff.update`, `staff.delete`, `customers.update`, `services.delete`,
`quotes.update`, `invoices.delete` and the rest were all there, guarded, and
reachable by the AI assistant. The screens simply never offered them.

So this was a UI job, not a backend one. One action was genuinely missing
(`bookings.delete`) and is now in.

## Delete is usually the wrong answer, and the UI now says so

A cleaning business's records refer to each other: a job points at a cleaner, an
invoice points at a job, payroll points at hours worked. Deleting the cleaner
would leave the rest making no sense, which is why the registry refuses it.

Every screen now offers the safe option first:

| Instead of deleting | Use | What it keeps |
|---|---|---|
| A cleaner who has worked | **Deactivate** | Every job, hour and payout |
| A customer with history | **Deactivate** | Bookings, jobs, invoices |
| A service already booked | **Deactivate** | Past bookings keep their price |
| An invoice already sent | **Void** | The record and its payments |
| A booking that happened | **Cancel** | The record and the reason |
| Money returned to a customer | **Refund** | Both entries, so the trail is honest |

Deactivating now genuinely removes someone from the new-booking and new-quote
dropdowns — `customers.search` filters them out by default, matching how
`staff.list` and `services.list` already behaved. The Customers screen itself
still lists them, so you can find and reactivate them.

Delete is reserved for records created in error, and the registry refuses it once
there is any history attached. That refusal is not a bug — it is the thing
keeping your reports correct.

## What each screen can now do

| Screen | Added |
|---|---|
| **Staff** | Edit, Deactivate / Reactivate, Delete |
| **Customers** | Edit, Deactivate / Reactivate, Delete *(owner)* |
| **Services** | Deactivate / Reactivate, Delete |
| **Quotes** | Edit (including line items), Delete |
| **Bookings** | Delete the record *(new action)* |
| **Invoices** | Void inline, Delete *(owner)* |
| **Payments** | Delete *(owner)* |
| **Invoice detail** | Record a refund |

Expenses and Users already had full edit and delete; they were the pattern the
rest now follow.

## Three things worth knowing

**Role gating is per button.** The actions do not share one role list —
deleting a customer, an invoice or a payment is owner-only, while editing them
is open to admins. Each button is gated against the same list its action
declares, so an admin is never shown a button that would fail server-side.

**The registry's `requiresConfirm` does not guard a button.** `runAction` only
honours that flag when the caller is the AI assistant. For the UI, the
confirmation is entirely the modal's job — which is why every delete goes
through one shared `ConfirmDelete` that makes you type the name back.

**`bookings.delete` had a trap in the schema.** `Job.bookingId` is an optional
relation with no `onDelete` rule, so Prisma's default would have quietly set it
to null and left the job stranded with no booking. The handler deletes the job
explicitly inside a transaction, and refuses outright when the job is invoiced,
has time logged, has started, or heads a recurring series.

---

## What I could not verify, and what you should click

Everything here typechecks and builds, and every delete button was
cross-checked against its action's input key in the registry. But I have no
sign-in, and I would not test deletions against your live business data. So no
button below has actually been pressed.

Please try these, in this order — each one takes seconds:

1. **Staff → a cleaner with jobs → Delete.** Should refuse, in plain English,
   and suggest deactivating. *(This is the most important one: it proves the
   guards hold and the error text reads properly.)*
2. **Staff → that same cleaner → Deactivate.** Should grey out, badge as
   Inactive, and keep every job.
3. **Staff → a brand-new cleaner with no jobs → Delete.** Should work.
4. **Staff → Edit.** Change a pay rate **and the calendar colour**; reopen to
   confirm both stuck, and check the colour on the calendar. *(`staff.update`
   did not accept `colour` at first — Zod strips unknown keys silently, so the
   change was reported as saved and thrown away. Fixed, but worth confirming.)*
5. **Bookings → a past, invoiced booking → Delete.** Should refuse and point at
   Cancel.
6. **Invoices → an unpaid one → Void.** Should stop counting in Outstanding.
7. **Sign in as an ADMIN, not an owner.** On Customers, Invoices and Payments
   the delete (bin) icon should not be there at all. Edit and Deactivate should be.

If anything in 1–7 behaves differently, tell me what you saw and I'll fix it.

## Not done

Jobs have no delete. A job is created by a booking and carries the time, photos
and checklist, so deleting one independently would strand the booking that made
it — cancelling the booking is the right route, and it already works. Say the
word if you want it anyway.
