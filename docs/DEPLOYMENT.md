# Deployment

Vercel + Supabase. Run `npm run check:env -- --production` before deploying —
it validates every variable below and explains how to obtain each one.

## 1. Vercel project setup

> **Set the Root Directory to `Frontend`.** The Next.js app is not at the repo
> root. Without this, the build fails with "No Next.js version detected" and
> `vercel.json` (crons, headers) is ignored.

| Setting            | Value                     |
| ------------------ | ------------------------- |
| Framework preset   | Next.js                   |
| **Root Directory** | **`Frontend`**            |
| Build command      | `npm run build` (default) |
| Install command    | `npm install` (default)   |
| Node version       | 20.x or newer             |

## 2. Environment variables

Add these in **Vercel → Settings → Environment Variables**, for Production and
Preview. `.env.local` is not deployed.

### Required

| Variable                        | Where to get it                                                                                                                                                 |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_APP_URL`           | Your deployed origin, e.g. `https://book.example.com`. Used for notification links, canonical URLs and OG tags — a wrong value sends clients to the wrong host. |
| `NEXT_PUBLIC_SUPABASE_URL`      | Supabase → Project Settings → API → Project URL                                                                                                                 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Project Settings → API → anon public                                                                                                                 |
| `DATABASE_URL`                  | Supabase → Database → Connection string → **Transaction pooler** (port 6543)                                                                                    |
| `DIRECT_URL`                    | Supabase → Database → Connection string → **Session pooler** (port 5432)                                                                                        |
| `CRON_SECRET`                   | Generate: `openssl rand -hex 32`. Without it the cron route returns 401 and **no reminder is ever sent**.                                                       |
| `RESEND_API_KEY`                | resend.com → API Keys. Without it email falls back to a console provider: messages are logged and marked sent, but **nothing is delivered**.                    |
| `NOTIFICATIONS_FROM_EMAIL`      | A sender on a Resend-verified domain, e.g. `תורים <noreply@yourdomain.com>`. Required alongside the key — half-configured is an error in every mode.            |

Both connection strings contain a `[YOUR-PASSWORD]` placeholder — replace it,
brackets included. `check:env` fails if the brackets survive.

### Optional

| Variable                                                                             | Effect if unset                                                                                                           |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_SMS_FROM`, `TWILIO_WHATSAPP_FROM` | SMS and WhatsApp channels stay on the console provider. Client messages go by email today, so this is genuinely optional. |
| `SUPABASE_SERVICE_ROLE_KEY`                                                          | `npm run db:claim` cannot resolve an email to a user id; pass the uuid instead. Never expose this key to the browser.     |

## 3. Database

Migrations do not run automatically on deploy. From a machine with `DIRECT_URL`
pointing at production:

```bash
npm --prefix Frontend run db:migrate
```

Verify afterwards that RLS is on for all seven tables and that no policy is
reachable by `anon` — the anon key is public, and RLS is the only thing
standing between tenants:

```sql
-- Expect 7 rows, all rls_enabled = true.
select tablename, rowsecurity as rls_enabled
from pg_tables where schemaname = 'public' order by tablename;

-- Expect ZERO rows.
select tablename, policyname, roles from pg_policies
where schemaname = 'public' and roles::text[] && array['anon','public'];
```

> **Migration `0008` will refuse to apply if any business points at a deleted
> auth user.** It adds the owner FK, and it will not delete rows to make room
> for itself. Find them with the query below, then reassign `owner_user_id` to
> a live account or delete those businesses deliberately, and re-run.
>
> ```sql
> select b.slug, b.name, b.owner_user_id from businesses b
> left join auth.users u on u.id = b.owner_user_id where u.id is null;
> ```

### Deleting an owner account destroys their tenant

Once `0008` is applied, removing a user in **Authentication → Users** cascades
to their business and every appointment, client name and phone number under it.
There is no prompt and no undo. Delete test accounts freely before launch; once
real businesses exist, treat that button as destructive.

`rate_limits` correctly shows RLS on with no policy at all; the other six each
have one `authenticated` owner policy.

## 4. Supabase Auth

- **Authentication → URL Configuration → Site URL**: set to `NEXT_PUBLIC_APP_URL`.
- Add `https://<your-domain>/**` to the redirect allow-list.
- **Authentication → Providers → Email**: decide whether to keep email
  confirmation on. It is on by default; the signup flow handles that case and
  tells the user to check their inbox.

## 5. Cron

`vercel.json` schedules `/api/cron/notifications` at `0 8 * * *` — 08:00 **UTC**,
which is 11:00 in Israel during IDT and 10:00 during IST. Vercel sends
`Authorization: Bearer $CRON_SECRET` automatically once that variable is set on
the project.

> **Why daily, and what it costs.** Hobby rejects any cron expression that
> fires more than once a day; a deploy with `*/15 * * * *` fails the build.
> But every message in the outbox — confirmation, owner alert, cancellation —
> is enqueued with `scheduledFor: now` and waits for the next dispatch. At one
> run a day, a client who books at 14:00 receives their confirmation the
> following morning, and a 24-hour reminder can land anywhere between 24 and 0
> hours before the appointment.
>
> Treat the daily schedule as a build-unblocker, not a working configuration.
> Either upgrade to Pro and restore `*/15 * * * *`, or leave `vercel.json`
> daily and drive the real cadence externally — see below.

### External scheduler (free, keeps the 15-minute cadence)

The endpoint is a plain authenticated GET, so anything that can make an HTTP
request on a schedule works. A GitHub Actions workflow in this repo:

```yaml
# .github/workflows/dispatch-notifications.yml
name: dispatch notifications
on:
  schedule:
    - cron: "*/15 * * * *"
  workflow_dispatch:
jobs:
  dispatch:
    runs-on: ubuntu-latest
    steps:
      - run: |
          curl -sS -f -H "Authorization: Bearer $CRON_SECRET" \
            "$APP_URL/api/cron/notifications"
        env:
          CRON_SECRET: ${{ secrets.CRON_SECRET }}
          APP_URL: ${{ secrets.APP_URL }}
```

Add `CRON_SECRET` and `APP_URL` as repository secrets. GitHub's scheduler is
best-effort and can lag by several minutes under load; cron-job.org is more
punctual if that matters.

Verify after the first deploy:

```bash
curl -s -H "Authorization: Bearer $CRON_SECRET" https://<your-domain>/api/cron/notifications
```

The response reports each channel's provider and whether it is `live`. If
`email` shows `"provider": "console"`, Resend is not configured and clients are
receiving nothing.

Vercel's own daily run is also only approximate — it fires within the hour, not
on the minute.

## 6. Post-deploy checks

```bash
npm --prefix Frontend run verify   # env, lint, types, tests, build
```

Then, against the deployed site:

- `/<slug>` returns 200 and lists services
- an unknown slug returns 404
- `/robots.txt` disallows `/dashboard`, `/b/`, `/login`, `/api/`
- `/sitemap.xml` lists active businesses
- `/login` shows the sign-in form, not the "not configured" notice
- a test booking creates rows in `appointments` and `notifications`
