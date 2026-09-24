# IOCL LPG Fleet System — core (v0.1)

Stack: Next.js (TypeScript) on Vercel + Supabase Postgres/Auth + Supabase pg_cron. Nothing runs on your laptop.

## Included
- `supabase/migrations/0001_init.sql` — full schema (users→audit logs), FKs, indexes, RLS on, default settings
- `src/lib/state-machine.ts` — states, valid transitions, context-aware next question, new-trip rule
- `src/lib/agency.ts` — duplicate-agency detection (flags only, never auto-merges)
- `src/app/api/driver/report` — authenticated, ownership-checked, idempotent (offline-safe) driver updates; auto trip numbering; pending-agency requests
- `src/app/api/cron/tick` — no-response detection (reminder, then admin alert after grace)
- `tests/core.test.ts` — `npx vitest`

## Included (batch 2 — backend)
- `src/lib/authz.ts` — server-side caller/role resolution (never trust a role from the client)
- `src/lib/audit.ts` — audit-log writer used by every admin mutation below
- `src/app/api/admin/agency-requests` — GET pending requests (with duplicate candidates attached); POST resolve as APPROVE_NEW / MERGE / REJECT — backfills trip + trip_events + vehicle once resolved
- `src/app/api/admin/agencies/merge` — merge two already-approved agencies later found to be duplicates (ADMIN-only, reassigns all references, deactivates the loser, never deletes)
- `src/lib/geofence.ts` + `src/app/api/geofence/process` — auto-fires REACHED_AGENCY/REACHED_PLANT from the vehicle's last GPS fix, through the same state machine the driver endpoint uses. Add a second pg_cron job pointing at `/api/geofence/process` alongside `/api/cron/tick` (same header, same schedule)
- `src/app/api/feedback` — POST (driver, ownership-checked like `driver/report`) and GET (admin/supervisor list, `?important=true` filter); important feedback pages the same recipients as a no-response alert
- `supabase/seed/demo.sql` — demo plants/agencies/drivers/vehicles/trips/agency-request/feedback, all flagged `is_demo` for a clean wipe later
- `tests/geofence.test.ts` — distance + geofence-trigger tests

## Not built yet (next steps)
Driver PWA, Admin UI, dashboard/filters, reports + Excel/CSV/PDF export, notification sender worker (WhatsApp/SMS/email/push), Mappls module, offline queue in the PWA.

## Deploy
1. Create a Supabase project. Paste `0001_init.sql` in SQL Editor (or `supabase db push`).
2. Create the first admin: Auth → Add user, then run
   `insert into profiles(id,name,role) values ('<auth-user-uuid>','Your Name','ADMIN');` and set a strong password.
3. Push repo to GitHub, import in Vercel, add env vars from `.env.example`. Vercel gives HTTPS.
4. Scheduler (free, 24×7, every 5 min). Vercel Hobby crons only run daily, so use Supabase instead:
   ```sql
   create extension if not exists pg_cron; create extension if not exists pg_net;
   select cron.schedule('fleet-tick','*/5 * * * *', $$ select net.http_post(
     url:='https://YOUR-APP.vercel.app/api/cron/tick',
     headers:='{"x-cron-secret":"YOUR_CRON_SECRET"}'::jsonb) $$);
   ```
   (Keep the secret out of git; store it via Supabase Vault if preferred.)
5. Backups: Supabase Free has no downloadable backups. Pro ($25/mo) gives daily backups (7-day retention). On Free, schedule a `pg_dump` from GitHub Actions.

## Integrations
- **Mappls/CVTMS**: check with Mappls/IOCL whether your account has authorized API access. If yes, add credentials to env vars only. If not, driver GPS and manual updates keep working. No scraping.
- **WhatsApp**: needs Meta WhatsApp Business Cloud API (paid per conversation) and approved templates. Until then, drivers use the PWA.
