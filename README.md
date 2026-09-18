# Borneo Clean — Cleaning Business Management System

A cleaning / field-service operations platform: bookings, scheduling, job management,
invoicing, payroll and reporting — plus an AI assistant that can *operate* the app,
not just answer questions about it.

Built with Next.js 15 (App Router), TypeScript, Tailwind, Prisma + SQLite.

---

## Quick start

```bash
npm install
npm run db:push     # create the SQLite schema
npm run seed        # load ~4 months of realistic demo data
npm run dev         # http://localhost:3100
```

### Demo accounts

| Email | Password | Role | Sees |
|---|---|---|---|
| `owner@borneoclean.my` | `owner123` | Owner | Everything, including users & settings |
| `admin@borneoclean.my` | `admin123` | Admin | Operations and money, not user management |
| `aisyah@borneoclean.my` | `staff123` | Cleaner | Own jobs, check-in/out, expenses |

The public customer booking form is at **`/book`** (no login required).

---

## The architecture that matters: one action registry

Every read and every mutation in the system is declared **once**, in `src/lib/actions/`:

```ts
defineAction({
  name: "bookings.create",
  description: "Create a booking … Use for requests like 'book John for a deep clean next Tuesday at 2pm'.",
  category: "Bookings",
  roles: ["OWNER", "ADMIN"],
  requiresConfirm: false,
  input: z.object({ /* zod schema */ }),
  handler: async (input, ctx) => { /* … */ },
});
```

From that single declaration the system derives, with no duplication:

| Derived thing | Where |
|---|---|
| The HTTP endpoint the UI calls | `POST /api/actions/[name]` |
| The OpenRouter tool schema (via zod → JSON Schema) | `toolSchemas()` in `src/lib/registry.ts` |
| The permission check | `roles` — enforced identically for UI and AI |
| The audit-log row | written automatically on every non-read action |
| The AI's confirm-before-execute gate | `requiresConfirm` |

**This is what makes the assistant extensible.** Adding a new capability to the app
means writing one `defineAction`. The assistant can use it immediately — no chatbot
code changes, no prompt edits, no hand-written tool schemas to keep in sync.

Currently **72 actions** across 15 categories. An Owner sees all 72; a Cleaner sees 19.

Scoping lives in the handler, not the page, so it holds for the UI and the assistant
alike: `jobs.list` and `expenses.list` silently narrow to the caller's own records when
the caller is a Cleaner, and `jobs.get` refuses a job they are not assigned to.

---

## AI assistant

Open it from the sidebar (or the **AI** button on mobile). It runs a bounded
tool-calling loop against OpenRouter over the registry.

**Setup:** add an OpenRouter key under **Settings → AI Assistant** (stored server-side,
never returned to the browser), or set `OPENROUTER_API_KEY` in `.env`. The model is a
setting too — any tool-calling model works, and swapping it requires no code changes.
`OPENROUTER_BASE_URL` can point at any OpenAI-compatible gateway.
Without a key the assistant shows a clear "configure a key" state; **everything else in
the app works normally.**

Things it can do:

- *"Book John for a deep cleaning next Tuesday at 2 PM."* — resolves the customer, looks up the service, creates booking + job
- *"Show me tomorrow's jobs."* → *"Move the second one to 3 PM."* — follow-ups resolve against what it last showed
- *"Which customers haven't paid yet?"* / *"How much did we make this month?"*
- *"Record RM120 petrol expense for today."*
- *"Find customers who haven't booked in the last 3 months."*

**Thread integrity.** Every `tool_call` the model emits gets a matching tool message
written immediately, then resolved as the call completes. This holds whether the turn
ends normally, hits the confirmation gate, errors, or the user cancels — so a thread can
never be left with an orphaned tool call (which the API rejects on the following turn).

**Safety.** 12 actions are marked `requiresConfirm` — rescheduling, cancelling,
recording payments and refunds, payouts, user changes. For these the assistant cannot
execute directly: it returns a proposal, the user sees the exact payload and clicks
confirm or cancel. The assistant also physically cannot call an action outside the
signed-in user's role — a Cleaner's assistant is handed only the 20 tools they're
allowed. Every action it takes is written to the audit log with `source: "assistant"`,
visible under **Activity log**.

---

## Conventions worth knowing

- **Money is integer cents everywhere** (`amountCents`, `priceCents`). Currency is MYR.
  Floats are never used for money; `src/lib/money.ts` holds the helpers. Tax is in
  basis points (600 = 6%).
- **Recurring bookings** are materialised as individual child bookings with a `parentId`,
  generated up to 6 months out. Rescheduling one visit moves only that visit; cancelling
  offers an explicit "whole series" option.
- **Revenue is recognised from payments received**, not invoices raised — so the
  dashboard and reports show cash actually collected.
- **Job costing** derives labour from tracked check-in/check-out time against each
  cleaner's pay basis (hourly / per-job / percentage), then adds materials and any
  job-linked expenses.

## Scoped out of v1 (deliberate)

- **Notifications are in-app only** (bell menu + `Notification` table). No email or SMS
  provider is wired up, since no credentials exist for one. The Settings toggles control
  which in-app notifications are generated.
- **Invoice PDF is the print stylesheet** — the invoice route is print-styled, so
  "Print → Save as PDF" produces a clean document. No PDF library in v1.
- **Uploads go to local disk** under `public/uploads`, with rows in the DB. No object storage.
- **Auth is a signed session cookie** with SHA-256 password hashing — appropriate for
  this stage, but move to bcrypt/argon2 and a real session store before production.
- **Drag-and-drop** is on the day/week staff board. Month view is read-only.

## Roles in practice

`Shell.tsx` shows each role only the navigation it can use, and the registry enforces
the same boundary server-side — the two cannot drift, because the role list lives on the
action itself.

A **Cleaner** signing in gets a different application, not a degraded one: `/dashboard`
renders their own day (jobs, hours this week, pay earned, check-in/out) rather than the
business P&L; `/expenses` shows only expenses they submitted and cannot mark them
reimbursed; `/calendar` shows only their own column and is read-only. These pages are
mobile-first, since that is where cleaners use them.

## Testing the assistant without a live model

`OPENROUTER_BASE_URL` makes the loop testable against a stub that returns canned
completions. The three sequences worth exercising are: read-only tool → final answer;
gated tool → confirm → execute; and gated tool → **cancel → send another message**,
which is the path that regresses if tool-call bookkeeping breaks.
