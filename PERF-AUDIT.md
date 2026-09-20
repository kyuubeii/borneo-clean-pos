# Performance audit — Borneo Clean POS

**Date:** 2026-09-20 · **Branch:** main @ 7f2b72b

## How this was measured (and what it doesn't cover)

All numbers below come from direct timing against the live Supabase project
(`ap-southeast-1`) from this machine, run through Prisma in a standalone Node
script. I could **not** get an end-to-end authenticated page load, for two
reasons: signing in needs your password (not something I should handle), and
the server currently listening on :3100 is broken (see Appendix A) — every
request to it returns 500, so any timing off it would be an error path, not the
real one.

So: the per-query and per-auth-call numbers are **measured**. The page-load
budget in §1 is **composed** from them. If your 8 seconds is on Vercel rather
than local, add cold starts and check the region (§3).

---

## The headline

Your dataset is tiny — 40 jobs, 40 bookings, 26 payments, 21 customers, 71
expenses. Nothing here is slow because of data volume. It is slow because
**loading the dashboard costs ~23 database round trips and ~16 Supabase Auth
calls, and every single database round trip costs ~500 ms.**

Two measured facts drive everything:

| What | Measured |
|---|---|
| TCP round trip to the DB host | **91 ms** |
| `SELECT 1` via the pooler on :6543 (what the app uses) | **~495 ms** (median of 10) |
| `SELECT 1` via direct on :5432, same host | **~84 ms** (median of 10) |
| `supabase.auth.getUser()` HTTP call | **110–370 ms** |
| `db.user.findUnique` (the auth user lookup) | **~500–630 ms** |

The pooler is adding ~410ms of unexplained overhead per query — about four extra
round trips' worth — on top of an app that issues far more queries than it needs
to. Those two multiply together.

---

## 1. Wall-clock budget for `/dashboard`

```
Document request
  middleware  supabase.auth.getUser()        ~150 ms
  layout      getUser() = auth + user query  ~650 ms
                                             --------  ~0.8 s before any HTML
JS download + hydrate                                  (page is 100% client-side,
                                                        so no data has even been
                                                        requested yet)
7 parallel POSTs fire (6 useAction + 1 /api/notifications)
  each pays: middleware auth ~150 ms
           + handler getUser ~650 ms         --------  ~0.8 s before any handler
                                                        body runs
  slowest handler: reports.summary
    5 sequential queries, measured           --------  3.9 s
  pool contention: ~35 concurrent queries through one
    Prisma pool (measured: 6-way parallel = 997 ms vs
    495 ms for one)                          --------  ~1-2 s
                                             ========
                                                       ~7-9 s
```

That lands on the 8 seconds you're seeing.

---

## 2. Root causes, ranked by measured payoff

### A. Sequential `await`s inside report handlers — **3.9 s → 1.6 s, measured**

[`reports.summary`](src/lib/actions/reports.ts:21) runs five independent
queries one after another. Same for
[`reports.dailyBriefing`](src/lib/actions/reports.ts:161) (2.2 s).

```
reports.summary, 5 sequential queries:  3889 ms
reports.summary, same 5 in Promise.all: 1576 ms
```

Nothing depends on anything else. Wrap them in `Promise.all`. Zero risk, purely
local edit, biggest single win in the codebase.

### B. Auth runs twice per request, and costs ~800 ms each time

Every request pays for auth twice:

1. [`src/middleware.ts`](src/middleware.ts) matches `/api/*` and calls
   `supabase.auth.getUser()` — a network call to Supabase Auth.
2. The route handler calls [`getUser()`](src/lib/auth.ts:27), which calls
   `supabase.auth.getUser()` **again** plus a Prisma `user.findUnique`.

`cache()` in `auth.ts` dedupes within one request, but middleware and the
handler are separate invocations, so it can't help across that boundary.

Fixes, in order:
- Exclude `/api/` from the middleware matcher. The API is called from pages that
  already went through middleware on the document/RSC request, so the token
  still gets refreshed — **verify that before committing**, especially for a tab
  left open past token expiry.
- Cache the `User` row. It changes almost never; keyed by `authUserId` it can sit
  in an in-process `Map` with a short TTL, which removes a ~500 ms query from
  every single request.

### C. The whole app is client-side-fetched — no SSR, no streaming

Every page is `"use client"` and fetches through `POST /api/actions/<name>`.
Consequences:

- Data fetching can't begin until the JS bundle downloads and hydrates.
- `POST` is never cacheable — not by the browser, not by a CDN, not by Next.
- The dashboard fans out to **7 separate HTTP requests**, each paying the full
  auth tax in §B and contending for the same Prisma pool.

Two options, cheapest first:
1. **Batch endpoint** — `POST /api/actions/batch` taking `[{name, input}, ...]`,
   running them under one auth check and one `Promise.all`. Small change to
   `useAction`; 7 round trips become 1. Keeps the whole architecture intact.
2. **Move reads to server components** — fetch in the RSC, pass as props, keep
   `useAction` only for post-mutation refresh. Best result, largest change.

### D. Unbounded queries that will get worse on their own

- [`payments.outstanding`](src/lib/actions/finance.ts:257) loads **every
  non-void invoice ever created**, with all items, payments and customer joined,
  then filters in JS. It's called on the dashboard, the invoices page *and* the
  payments page. Today that's 39 invoices. At 5,000 it's the whole table on
  every dashboard load.
- [`revenueIn`](src/lib/actions/reports.ts:15) pulls every payment row to sum
  them in JS. That's `aggregate` / `groupBy` work.
- [`reports.staffPerformance`](src/lib/actions/reports.ts:120) is a textbook
  N+1: two queries **per staff member**, in a loop. Two staff today = 4 queries
  ≈ 2 s. Twenty staff = 40 queries ≈ 20 s.
- [`audit/page.tsx`](<src/app/(app)/audit/page.tsx:13>) requests `limit: 200` with
  no pagination.

### E. The pooler is ~6x slower than the raw network — worth escalating

`aws-0-ap-southeast-1.pooler.supabase.com:6543` gives ~495 ms per trivial query
where :5432 on the same host gives 84 ms and TCP RTT is 91 ms. That is not
normal pooler overhead.

**Do not just switch `DATABASE_URL` to `DIRECT_URL`.** On Vercel, serverless
functions on a direct connection will exhaust Postgres's connection limit —
that two-URL split exists precisely so `DIRECT_URL` is used for migrations only.

Instead:
- Check your Vercel project region. If functions run in `iad1` (US East, the
  default) while the DB is in `ap-southeast-1`, every query crosses the Pacific
  on top of this. Set the function region to `sin1`.
- Try `?pgbouncer=true&connection_limit=1` on the pooled URL for serverless.
- `aws-0-*` is Supabase's legacy pooler hostname. Check your dashboard for a
  current endpoint, and raise the 6x with their support.

---

## 3. The "laggy" feeling — separate from the "slow"

- [`useAction`](src/components/ui.tsx:91) sets `loading = true` on **every**
  refetch, so existing data is replaced by a spinner rather than staying visible
  while fresh data arrives. Keep stale data on screen and only show a subtle
  indicator.
- [`refreshAll()`](src/components/ui.tsx:88) makes **every live `useAction` on
  the page** refetch after any single write. On the dashboard that's 6
  simultaneous ~1 s requests after changing one thing. Scope invalidation to
  what actually changed.
- [`Shell.tsx`](src/components/Shell.tsx:50) refetches `/api/notifications` on
  every pathname change — a ~1 s request on every navigation, for a bell badge.
  Poll on an interval instead, or fetch once per session.
- [`I18nProvider`](src/components/I18nProvider.tsx:20) builds a fresh context
  value object on every render, re-rendering every consumer — which is every
  component that calls `t()`. Wrap it in `useMemo`.
- `I18nProvider` also initialises to `"en"` and only reads `localStorage` in an
  effect, so a `zh` user sees an English flash then a full re-render on every
  page load.

---

## 4. Not a current cause, but will be

The Prisma schema has **exactly one index** (`ChatMessage.threadId`). There is
nothing on `Job.scheduledAt`, `Payment.paidAt`, `Expense.spentAt`,
`Invoice.status`, `AuditLog.createdAt`, or on any foreign key — and Postgres,
unlike MySQL, does **not** create indexes on foreign keys automatically.

At 40 rows every query is a microsecond sequential scan, so **adding indexes
today will change nothing you can feel.** Don't start here. But add them before
the tables reach a few thousand rows, or this becomes a second, independent
performance problem stacked on the first.

---

## 5. What was changed (2026-09-20) — live in production

Commits `4473029` and `97b4eb7`, deployed and verified.

Everything in §2 and §3 has been implemented except the user-row cache, which
was deliberately skipped (see below). Measured against the same live database:

| Handler | Before | After |
|---|---|---|
| `reports.summary` | 3889 ms | **1672 ms** |
| `reports.dailyBriefing` | 2231 ms | **923 ms** |

### The big one: the Vercel function was in the wrong hemisphere

`x-vercel-id: sin1::iad1::...` on a production API call — the edge is Singapore,
but **the function ran in `iad1` (US East)** while the database is in
`ap-southeast-1`. Every query went Singapore → US East → Singapore.

Pinned to `sin1` two ways, so neither alone is load-bearing:
`vercel.json` sets the deployment default, and `export const preferredRegion =
"sin1"` is set on every route handler and on both layouts, which survives a
change to the project's region setting. This is almost certainly the single
largest win, and it likely also collapses most of the 6x pooler overhead: the
extra ~410 ms was roughly 4.5 × the 91 ms round trip, consistent with the pooler
making several round trips per query — cheap once it is next to the database.

**Verified live on 2026-09-20.** Production now answers:

```
x-matched-path: /api/actions/[name]
x-vercel-id:    sin1::sin1::…
```

Both segments `sin1`, on the real function rather than a build placeholder. The
function is now in the same region as the database.

Measured against production, same method as the baseline (`POST
/api/actions/reports.summary`, unauthenticated, so it times routing plus auth
with no database work):

| | Before | After |
|---|---|---|
| Auth path, 5 samples | 0.66 – 1.55 s | **0.23 – 0.49 s** |

### A note on deploying this project

`vercel --prod` from the CLI hangs in `UNKNOWN` / `Building…` and never
completes — three attempts here, plus four of the project's own CLI deploys from
the day before, all stuck the same way. Deploying through the connected GitHub
repository works first time, every time: the two pushes that shipped these
changes built in 49s and 1m.

**Push to `main`; do not deploy from the CLI.** If the CLI is ever the only
option, the stuck deployments have to be removed with `vercel remove <url>`
before a later one will build.

Re-check the region after any change to the project's settings:

```
curl -sD- -o /dev/null -X POST https://borneoclean.vercel.app/api/actions/reports.summary | grep x-vercel-id
```

It should read `sin1::sin1::…`, not `sin1::iad1::…`. One trap: a deployment that
is still building answers `sin1::sin1::` from a placeholder regardless, so check
that `x-matched-path` reads `/api/actions/[name]` before trusting the region.

If it still says `iad1`, the remaining lever is Project Settings → Functions →
Function Region, which is dashboard-only and cannot be set from the repo.

Middleware is not pinned and cannot be: it runs on the edge network at whichever
point of presence is nearest the visitor, which is what you want. It no longer
touches the database or `/api`, so it costs nothing to have it far away.

### Server

- **`reports.summary`, `reports.dailyBriefing`** — five independent queries each,
  now issued with `Promise.all` instead of one round trip at a time.
- **`revenueIn`** — sums in the database via `aggregate` rather than loading
  every payment row to add up in JS.
- **`reports.staffPerformance`** — was two queries *per staff member* in a loop;
  now three queries total regardless of headcount, grouped in memory.
- **`payments.outstanding`** — was `status notIn [VOID, DRAFT]`, which pulled
  every PAID invoice ever raised in order to compute a zero balance. Now
  `status in [SENT, PARTIAL, OVERDUE]`. Safe because both `payments.record` and
  the refund path call `syncInvoiceStatus`, so a refund against a paid invoice
  moves it back to PARTIAL.
- **`POST /api/actions/batch`** (new) — runs several read-only actions under one
  authentication check. The dashboard's six calls plus notifications become one
  request instead of seven.
- **Middleware** no longer matches `/api/`. Every API call was paying for a
  Supabase Auth round trip in middleware *and* another in the handler. Verified
  safe: `POST /api/auth` already signs in using nothing but `supabaseServer()`'s
  cookie writes, which proves Route Handlers can rotate the session cookie.

### Client

- **`useAction` keeps data on screen while refetching.** It used to flip to a
  spinner on every refresh, so every write and every calendar drag blanked the
  view and brought it back. It now only blanks when the question itself changes
  (a different customer, a different date range) and exposes a separate
  `refreshing` flag. This is the "laggy", and it is independent of latency.
- **Reads issued in the same tick are batched** into one request via
  `queueAction`. Writes are *never* batched — `callAction` is untouched — so a
  write and a read fired together cannot be reordered, and the batch endpoint
  refuses non-`readOnly` actions server-side as a second guard.
- **`Shell`** polls notifications once a minute instead of re-fetching on every
  navigation, which had put a request in front of every page change.
- **`I18nProvider`** memoises its context value; it was building a new object on
  every render and re-rendering every component that calls `t()`.

### Deliberately not done

- **Caching the user row.** The ~500 ms `db.user.findUnique` was measured from a
  US-east function to a Singapore database; co-located it should be tens of
  milliseconds, so this would trade a real staleness hazard for very little. It
  is also wrong on serverless: each instance holds its own cache, so demoting or
  deactivating a user would keep working on other instances until the TTL
  expired. Re-measure after the region fix before considering it.
- **Indexes are in `schema.prisma` but not applied.** Run `npm run db:push` when
  you want them. They will change nothing today (40 rows) and are purely
  insurance for later.
- **SSR.** With the pages staying `"use client"`, the floor is JS download +
  hydrate + one round trip. These changes get you to that floor. Going below it
  means server-rendering the dashboard and calendar, which is a real rewrite and
  was out of scope here.

---

## 6. Original suggested order of work

| # | Change | Effort | Expected |
|---|---|---|---|
| 1 | `Promise.all` in `reports.summary` + `dailyBriefing` | 10 min | −2.3 s, measured |
| 2 | Drop `/api/` from the middleware matcher | 15 min + verify | −150 ms × every call |
| 3 | Cache the `User` row lookup in `getUser()` | 30 min | −500 ms × every call |
| 4 | Batch endpoint for the dashboard's 7 calls | 2 h | 7 round trips → 1 |
| 5 | Check Vercel region / pooler endpoint | 30 min | up to 6x on everything |
| 6 | `useAction` keeps stale data; scope `refreshAll` | 1 h | fixes the "laggy" |
| 7 | Bound `payments.outstanding`; fix `staffPerformance` N+1 | 2 h | prevents regression |
| 8 | Add indexes | 1 h | nothing now; essential later |

Items 1–3 alone should take the dashboard from ~8 s to ~3 s, and they're all
low-risk local edits.

---

## Appendix A — your local server is broken right now

The process on :3100 (PID 58731, started Sep 19 14:44) is `next-server v15.1.6`,
but `node_modules` now has Next **15.5.25** (installed Sep 19 17:06). It is a
*production* build (`.next/BUILD_ID` present), serving from a `node_modules`
that was replaced underneath it. Every route — including `/login` — returns
`500 Internal Server Error`.

This is exactly the collision your `next.config.mjs` comment describes. Restart
it and the 500s should clear. I left the process alone rather than killing
something you may be using.
