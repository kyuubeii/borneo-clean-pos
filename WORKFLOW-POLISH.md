# Workflow polish — 21 September 2026

## Git and rollback

The original working state was saved in commit `aa3bca1` on `main` before this work.
Changes are isolated on `codex/workflow-polish`.

To run the original version with a clean working tree:

```sh
git switch main
npm run dev
```

To return to the improved version:

```sh
git switch codex/workflow-polish
npm run dev
```

Restart the local server after switching. Commit any later work before switching.
The permanent original reference is `aa3bca1`, even if `main` advances later.
Git restores code, not business records. No production data migration or repair was performed.

## Changes

- Quote-based bookings display all original quote lines, including custom items. Invoices created from those jobs inherit the quote's discount and tax unless a tax override is explicitly supplied. No schema change is required: converted quotes are immutable and remain the authoritative source of their agreed lines.
- A converted quote links to its booking instead of offering conversion again. Draft quotes must be accepted before conversion. The former Send button now says Mark sent; quote preview displays lines, discount, tax and notes.
- Booking and job completion, cancellation and reopening stay synchronized. Closing a job closes open time entries. Booking edits save fields and status atomically, synchronize job instructions/address/duration, and validate duration changes.
- Booking creation, recurring creation, assignment and rescheduling check availability in Malaysia time. The current job is excluded from its own availability check. Overnight overlaps and duplicate or inactive cleaners are handled. Schedule transactions use serializable isolation with retry for Prisma P2034; an invalid occurrence rolls back the whole recurring creation.
- Customer selection is searchable and supports inline creation. New-booking dates reset to the selected calendar date. Payment entry resets its amount to the latest balance and clears the previous reference.
- Booking lists support pagination, reference/customer search and date range filters. Sorting is explicitly per page.
- Calendar cards link to jobs. Monthly overflow opens the day's list. Dragging opens a review of the date and full team, then saves date and assignments together. Multi-cleaner teams are preserved in the initial proposal. Day view fits narrow screens.
- Main list load failures expose retry controls. Mobile Jobs has loading and empty states. Modals manage keyboard focus and nested scroll locking. AI confirmations display business fields, resolved record names, MYR amounts and Malaysia time; raw payloads remain available under Technical details.

## Validation

- `npm run test:polish`: 16 integration checks passed. The runner generates a separate SQLite client from the app schema, creates a temporary database, runs checks and cleans it up. It does not use the production database.
- `tsc --noEmit --incremental false`: passed separately because the existing Next build configuration skips type checking.
- `npm run build`: passed.
- `git diff --check`: passed.
- Authenticated Chrome checks: booking list and customer search rendered; a lowercase customer query returned the matching customer; the new-booking modal rendered; Day -> next day -> New used the selected date. No business records were created through the browser.

## Limits and follow-up checks

- SQLite tests do not prove PostgreSQL concurrency behavior. Serializable retries have not been load-tested against the hosted database.
- Real AI model requests, payment posting in the live UI, full mobile/keyboard interaction and drag-drop submission still require a controlled end-to-end acceptance pass. Browser tooling was intermittent during the final pass.
- Existing historical invoice discrepancies are not rewritten automatically.
- Quoted jobs keep their agreed prices. A revised quote is needed to replace an agreed total; the quick single-price correction cannot overwrite it.
- Git push publishes the branch; this work does not merge into `main` or claim production deployment success.
