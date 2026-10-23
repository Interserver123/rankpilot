# RankPilot

**Every client. Every location. Every search signal.**

An agency-first SEO operations platform. This release is the PRD's recommended MVP (Phase 1 foundation + Phase 2 organic rank tracking). The database schema already covers every planned module.

## What works now

| Area | Status |
|---|---|
| Projects, clients, multi-location setup, competitors | ✅ 6-step wizard; nothing besides details + one location is required |
| Keywords | ✅ Manual + CSV import, tags, bulk pause/resume/tag/delete. Dedupe never merges different location/device/engine/language |
| Organic SERP tracking | ✅ DataForSEO (Live Advanced) and YepAPI (Google SERP) adapters + a clearly labelled mock provider for development |
| API keys | ✅ Admins add, test and remove provider keys under Integrations; encrypted at rest (AES-256-GCM, `APP_ENCRYPTION_KEY`), write-only, audited |
| Scheduling | ✅ 7-day default; organic/maps/LLM/citations each have their own interval, run time, enabled state. Uses the project's time zone (DST-safe), stores UTC |
| Manual refresh | ✅ Keyword / selected / all. Runs as an async job with a cost confirmation, deduped at the target level, never changes the schedule |
| Job system | ✅ Postgres-backed queue, idempotency, per-provider concurrency + rate limits, `Retry-After`, exponential backoff, bounded retries, partial results, stale-worker recovery |
| History | ✅ Every observation stores provider, requested location, depth, timestamp and job. Failures are never stored as rankings |
| Job monitor, usage & costs, budgets | ✅ Filters, per-target detail, approve/cancel, per-project/module/provider spend, block or require-approval budgets |
| Access control | ✅ Admin / manager / member (assigned projects) roles; client-viewer model enforced server-side; RLS deny-by-default on the Data API |
| Maps grid, AI visibility, citations, GSC, GA4, client dashboards, PDF reports | 🗓 Planned (Phases 3–7). Tables, grid math and cost formulas exist; UI shows "planned" |

## Architecture

```
Browser ──> Next.js (App Router, server components + server actions)
              │  authz on every request (src/server/authz.ts)
              ▼
          PostgreSQL (Supabase) <── worker process (npm run worker)
              ▲                      ├─ scheduler tick: enqueue due configs (never calls providers)
              │                      └─ claim jobs → provider adapter → normalize → persist
          /api/cron/schedule (optional HTTP cron alternative to the worker's scheduler)
```

- `src/lib/` — pure logic: scheduling, ranking change/distribution, grid generation + metrics, cost estimates, keyword CSV/dedupe, permissions.
- `src/server/providers/` — adapter contract (capabilities, validation, cost, execution, normalization, error classification, retry eligibility, limits).
- `src/server/jobs/` — queue, organic collector, scheduler, worker.
- `src/server/services/` — project, refresh, admin operations (all audited).
- `supabase/migrations/` — schema + RLS.

Key reliability rules (from the PRD):
- A target is marked `in_flight` before a provider call. If the worker dies or the call times out after sending, it becomes `uncertain` and is **not** retried automatically (it may have been billed).
- Auth / insufficient-funds errors stop the batch; invalid requests fail that target only; transient errors retry with backoff up to `max_attempts`.
- Missed schedule slots are logged and recovered with **one** run, never a backfill.
- "Not found within depth N" (`not_found`) is distinct from "failed" (no observation), and averages exclude both.

## Local development

Requires Node 20+ and PostgreSQL 15+.

```bash
cp .env.example .env.local     # set DATABASE_URL; AUTH_MODE=dev and PROVIDER_MOCK_ENABLED=true for local use
createdb rankpilot
npm install
npm run migrate
npm run dev                    # http://localhost:3000
npm run worker                 # separate terminal: scheduler + job processing
```

### Signing in

By default RankPilot uses built-in **email + password** sign-in (scrypt-hashed passwords, revocable server-side sessions):

1. Open `/sign-in`. On a fresh database it shows **Set up your workspace** for the owner email (`OWNER_EMAIL`, default `ratulroydigital@gmail.com`): enter your name, agency and a password (10+ characters). If the workspace already exists but the owner has no password yet, it shows **Set your owner password** instead. Only the owner email can do either; set `OWNER_SETUP_CODE` to also require a secret code.
2. Add teammates under **Settings → Team**. Each new member gets a one-time temporary password to share with them; they can change it under **Settings → My account**.
3. Forgotten passwords: an admin clicks **Reset password** next to the member (this signs them out everywhere).

Alternatives: set `AUTH_PROVIDER=supabase` together with the Supabase keys to use Supabase Auth (the keys alone never change the login method), or set `AUTH_MODE=dev` for email-only sign-in during local development (ignored in production).

### Tests

```bash
npm test                                                  # unit tests
DATABASE_URL_TEST=postgres://…/rankpilot_test npm test    # + integration tests (drops and recreates the public schema of that DB)
npm run typecheck
```

Integration tests cover the defaults, dedupe, partial batches, retries, auth-stop, stale-worker recovery, budgets (block / approval), cost confirmation, missed-slot recovery, independent schedules, pausing, access resolution (unassigned member, other org, revoked client) and user provisioning. Providers are mocked; no live API calls.

## Production setup

1. **Database**: run the migrations (`npm run migrate`, or `supabase db push` on Supabase). Built-in password sign-in works out of the box; serve the app over HTTPS (session cookies are `Secure` in production). To use Supabase Auth instead, set `AUTH_PROVIDER=supabase`, `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` and disable public sign-ups in Supabase. Leave `AUTH_MODE` unset.
2. **Web app**: deploy Next.js (e.g. Vercel) with `DATABASE_URL` (server-only).
3. **Worker**: run `npm run worker` as a long-lived process (Railway, Fly.io, Render, a VM). Do not run collection inside web requests. Optionally call `GET /api/cron/schedule` with `Authorization: Bearer $CRON_SECRET` from a cron service instead of relying on the worker's scheduler loop.
4. **Provider**: set `APP_ENCRYPTION_KEY` and add keys in-app under **Integrations**, or set `YEPAPI_API_KEY` / `DATAFORSEO_LOGIN`, `DATAFORSEO_PASSWORD`, and your contracted `DATAFORSEO_COST_PER_REQUEST` (leave blank if unknown: estimates then show "unknown" instead of a guess). Never set `PROVIDER_MOCK_ENABLED` in production (it is ignored when `NODE_ENV=production`).
5. **Budgets**: add an organization-wide budget under **Usage & Costs** before scaling keyword counts.

## Using Supabase as the database

1. Create a project at supabase.com (pick the region closest to your users) and save the database password.
2. In the project, click **Connect** → **Connection string** → **Transaction pooler** and copy the URI
   (`postgresql://postgres.<ref>:[YOUR-PASSWORD]@aws-0-<region>.pooler.supabase.com:6543/postgres`). Replace `[YOUR-PASSWORD]`; URL-encode special characters in it (e.g. `@` → `%40`).
3. Set it as `DATABASE_URL` (Cloudflare: `npx wrangler secret put DATABASE_URL`, or Workers → rankpilot → Settings → Variables and Secrets → add secret).
4. Redeploy and open `/api/health`; tables are created automatically on first request.

TLS is enabled automatically for Supabase hosts, and prepared statements are disabled on the transaction pooler (port 6543). Supabase is only the database here; sign-in uses RankPilot's built-in accounts unless you also set the Supabase Auth keys.

## Deploying to Vercel (recommended, simplest)

1. Go to vercel.com → **Sign up / Log in with GitHub** → **Add New… → Project** → import `Interserver123/rankpilot` (allow Vercel access to the repository when asked).
2. Framework is detected as **Next.js**; leave the build settings alone (`npm run build` builds the Node version automatically on Vercel).
3. Open **Environment Variables** and add `DATABASE_URL` = your Supabase **Transaction pooler** string. Optional: `OWNER_EMAIL`, `OWNER_SETUP_CODE`.
4. Click **Deploy**, then open `https://<your-app>.vercel.app/api/health` (should show `"status":"ok"`) and `/sign-in`.

`vercel.json` pins functions to the Mumbai region (`bom1`) next to the Supabase database for low latency. The background job worker (`npm run worker`) still needs a separate always-on Node host.

## Deploying to Cloudflare Workers

```bash
npx wrangler secret put DATABASE_URL     # Postgres connection string (Hyperdrive recommended)
npm run deploy                           # OpenNext build + wrangler deploy (worker name: rankpilot)
```

- Tables are created automatically on first request (bundled migrations), so no shell access is needed. `GET /api/health` reports database, migration and auth status without exposing secrets.
- Workers cannot share a database connection between requests, so the app opens one connection per request there. Put **Hyperdrive** in front of Postgres to keep this fast.
- Password hashing (scrypt) uses ~45 ms of CPU per sign-in: use the Workers **Paid** plan; the free plan's 10 ms CPU limit can reject sign-ins.
- Workers cannot run the long-lived job worker. Run `npm run worker` on any Node host (VPS, Railway, Fly.io) with the same `DATABASE_URL` to collect rankings on schedule.
- Local Workers preview: put `DATABASE_URL=…` in `.dev.vars`, then `npm run preview`.

## Known limitations / next steps

- **Provider validation pending.** Run the PRD §18 evaluation (small keyword set across locations, compare with manual checks) before relying on DataForSEO data. The unit assumption (1 billable request per keyword up to depth 100) should be checked against your plan; actual cost from responses is recorded when DataForSEO returns it.
- YepAPI: implemented from its public llms.txt only. City targeting (`location_name` as “City,Region,Country”) and the per-page price are unverified against live responses; run the PRD §18 check. Other providers: add adapters in `src/server/providers/serp/` and register them in `registry.ts` and `PROVIDER_SPECS`.
- Rate limiting for sign-in / refresh / export is in-memory per process. Use a shared store (e.g. Redis) if you run several web instances.
- Job/observation timestamps on the job pages render in UTC; project pages use the project time zone.
- Phase 3+ modules (Maps, Google OAuth, LLM, citations, client dashboards, PDF reports) are not built yet.
