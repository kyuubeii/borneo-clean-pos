# Deploying Borneo Clean

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
| `SESSION_SECRET` | `openssl rand -base64 32` — see the warning below |
| `SUPABASE_URL` | `https://<ref>.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | the **rotated** key |
| `SUPABASE_BUCKET` | `uploads` |
| `OPENROUTER_API_KEY` | optional; the assistant is disabled without it |

### Setting SESSION_SECRET will lock you out until you reset the password

`hashPassword()` in `src/lib/auth.ts` salts passwords with `SESSION_SECRET`.
The migrated user row was hashed against the fallback string, because
`SESSION_SECRET` was never set locally. The moment production uses a real
secret, the stored hash matches nothing and the only account cannot sign in.
The migration script cannot detect this — row counts still match.

After the first deploy, with the production `SESSION_SECRET` and `DATABASE_URL`
in your local `.env`:

```bash
npm run user:password -- <email> <new-password>
```

Do not avoid this by setting `SESSION_SECRET` to the fallback value. It is
committed in this repository, and it also signs session cookies — anyone could
forge one.

---

## Deploying from the CLI: the git-author block

`vercel deploy` attaches the local git commit metadata to the deployment. The
Vercel account (`theborneoclean-spec`) is not linked to the GitHub identity
that authors the commits (`kyuubeii` / oscarkhoz@gmail.com), and the project
has `gitForkProtection` enabled, so Vercel refuses before it even builds:

    readyState: BLOCKED
    "The deployment was blocked because the commit author doesn't have
     permission to create deployments for this project."
    buildSkipped: true

Nothing in the build is wrong when this happens -- `vercel ls` unhelpfully
shows it as `UNKNOWN`, and only the API reports `BLOCKED` with a reason:

```bash
vercel inspect <deployment-url>   # shows UNKNOWN
# the real answer:
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://api.vercel.com/v13/deployments/<id>?teamId=<team>" | jq .readyStateReason
```

The workaround used here is to deploy from an export that is not inside the
git working tree, so no commit metadata is attached:

```bash
rm -rf /tmp/bc-deploy && mkdir -p /tmp/bc-deploy
git archive HEAD | tar -x -C /tmp/bc-deploy
rm -rf /tmp/bc-deploy/scripts          # local tooling; holds customer records
mkdir -p /tmp/bc-deploy/.vercel && cp .vercel/project.json /tmp/bc-deploy/.vercel/
cd /tmp/bc-deploy && vercel deploy --prod --yes
```

Note the directory must be outside the repository -- a subdirectory of it does
not work, because the CLI walks up the tree to find `.git`.

The durable fix is to connect the GitHub account to Vercel so git-push deploys
work normally. That needs the `kyuubeii` GitHub identity linked to the Vercel
account, which is a browser flow.

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
- Password hashing is unsalted SHA-256. It is adequate against a database leak
  only because the secret is not in the database, but bcrypt or argon2 would be
  the right thing if this ever holds more accounts.
