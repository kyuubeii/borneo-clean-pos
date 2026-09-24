# Deploying Borneo Clean

Live at <https://borneoclean.vercel.app> (Vercel project `borneo-clean-pos`).
The project named `borneoclean` serves borneocleanl.vercel.app (note the extra
"l") and is the spare. Environment variables are per project: set them on
`borneo-clean-pos` for the live site, then redeploy.

Repository: <https://github.com/kyuubeii/borneo-clean-pos> (private — it contains
real customer names, phone numbers and addresses in `scripts/customer-profiles.json`,
so keep it that way).

Target: Vercel for the app, Supabase Postgres for the database, Supabase
Storage for job photos and expense receipts.

Steps 1–3 have to happen in order. Nothing below has been run yet.

---

## 1. Supabase

**Rotate the service role key first.** The one from the initial setup was sent
over chat, and it bypasses row-level security entirely. Settings → API →
rotate, and take the new value from there.

Create the storage bucket:

- Storage → New bucket → name it `uploads`, set it **Public**.

Public means anyone holding a file's URL can open it, without signing in.
Filenames are 16 random hex characters, so URLs are not guessable, but these
are photographs of customers' homes — if that tradeoff is wrong, the bucket
must be private and `src/app/api/upload/route.ts` needs signed URLs instead of
`getPublicUrl`, which changes how photo URLs are stored.

Collect both connection strings from Connect → ORMs → Prisma. Copy them as
given rather than assembling the hostname by hand — the region slug varies:

- `DATABASE_URL` — pooled, port **6543**, used by the app
- `DIRECT_URL` — direct, port **5432**, used by migrations

## 2. Create the schema and move the data

Put the two connection strings in `.env` locally (it is gitignored), then:

```bash
npm run db:push
```

That creates all 26 tables in Supabase. Then copy the existing records across:

```bash
npx prisma generate --schema prisma/sqlite.prisma
SQLITE_URL="file:./prisma/dev.db" npx tsx scripts/migrate-to-postgres.ts
```

The script copies tables in foreign-key order, keeps every id, and fails loudly
if any table's row count does not match. Expect 21 customers, 40 jobs, 39
invoices, 26 payments, 71 expenses.

## 3. Vercel

Log in as the Borneo Clean account (`theborneoclean-spec`, team **Borneo Clean**).
Set these environment variables **before** the first deploy:

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | pooled string, port 6543 |
| `DIRECT_URL` | direct string, port 5432 |
| `SESSION_SECRET` | legacy; only salts the unused `User.password` column |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<ref>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | the publishable key (this one is meant to be public) |
| `SUPABASE_URL` | `https://<ref>.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | the **rotated** key |
| `SUPABASE_BUCKET` | `uploads` |
| `OPENROUTER_API_KEY` | optional; the assistant is disabled without it |
| `APNS_KEY_ID` | optional; push to the iPhone app. The 10-character Key ID of the APNs key |
| `APNS_TEAM_ID` | the Apple developer Team ID, `NJ99DBJWF9` |
| `APNS_KEY` | the whole `.p8` file, including the BEGIN/END lines |
| `APNS_BUNDLE_ID` | optional; defaults to `com.borneoclean.app` |

Push is silent until all three APNs values are set: notifications still go to
the bell exactly as before, and nothing is sent to Apple. The `.p8` key goes
straight into Vercel -- never into chat, the repository or a `.env` file that
leaves this machine.

### Accounts

Sign-in is Supabase Auth. The app's `User` table still holds the role, the
name and the staff link, joined to `auth.users` on `authUserId` — not on
email, because the two systems normalise case differently and the address can
change.

`User.password` and `SESSION_SECRET` are legacy. Nothing reads them at
sign-in; they are kept so the previous login path still works if this has to
be rolled back, and can be dropped once Supabase Auth has proven itself.

Giving an existing app user a Supabase account, or resetting a password when
nobody can get in:

```bash
npx tsx scripts/link-supabase-auth.ts <email> <initial-password>   # first time
npm run user:password -- <email>                                   # afterwards
```

Both are safe to re-run: an existing auth account is reused rather than
duplicated, so a failed attempt does not leave an orphan holding the address.

---

## Deploying

Both Vercel projects — `borneo-clean-pos` (live, borneoclean.vercel.app) and
`borneoclean` (spare, borneocleanl.vercel.app, same database) — are linked to
`kyuubeii/borneo-clean-pos` with production branch `main` and automatic
deployments enabled. Pushing to `main` deploys both:

```bash
git push origin main
```

The functions run in `sin1`, pinned by `vercel.json` and by `preferredRegion`
on the route handlers, because the database is in ap-southeast-1 and Vercel's
default `iad1` put every query across the Pacific.

### If a deployment comes back BLOCKED

`gitForkProtection` is on, and the CLI attaches the local git commit metadata.
If the Vercel account is not linked to the GitHub identity that authored the
commit, the deployment is refused before it builds:

    readyState: BLOCKED
    "The deployment was blocked because the commit author doesn't have
     permission to create deployments for this project."
    buildSkipped: true

`vercel ls` unhelpfully shows that as `UNKNOWN`. Only the API gives a reason:

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://api.vercel.com/v13/deployments/<id>?teamId=<team>" | jq .readyStateReason
```

The fallback is to deploy from an export that is not inside the git working
tree, so no commit metadata is attached:

```bash
rm -rf /tmp/bc-deploy && mkdir -p /tmp/bc-deploy
git archive HEAD | tar -x -C /tmp/bc-deploy
rm -rf /tmp/bc-deploy/scripts          # local tooling; holds customer records
mkdir -p /tmp/bc-deploy/.vercel && cp .vercel/project.json /tmp/bc-deploy/.vercel/
cd /tmp/bc-deploy && vercel deploy --prod --yes
```

The directory has to be outside the repository — a subdirectory of it does not
work, because the CLI walks up the tree looking for `.git`.

---

## Notes

- **Local development now needs Postgres.** `prisma/schema.prisma` targets
  postgresql, so a `.env` pointing at `file:./dev.db` will fail. Point local
  development at Supabase too, or at a separate Supabase project.
- `prisma/sqlite.prisma` is a read-only mirror of the schema. It exists only so
  the migration script can read the old `dev.db`; it is not used by the app.
- `next.config.mjs` sends build output to `.next-build` locally so a build
  cannot clobber a running dev server, and to `.next` on Vercel where the
  platform expects it.
- `src/middleware.ts` refreshes the Supabase session and does nothing else.
  It has to exist: Server Components cannot set cookies, so without a request
  that can, access tokens would expire and never be replaced. Authorisation
  stays in the action registry, where it can see what is being asked — putting
  access decisions in middleware is how the Next.js auth-bypass advisories
  became exploitable elsewhere.
- Supabase stores passwords with bcrypt, so the old unsalted SHA-256 hashing
  is no longer on the sign-in path.
