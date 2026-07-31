# Deployment

Vercel + Supabase. Run `npm run check:env -- --production` before deploying —
it validates every variable below and explains how to obtain each one.

## 1. Vercel project setup

> **Set the Root Directory to `Frontend`.** The Next.js app is not at the repo
> root. Without this, the build fails with "No Next.js version detected" and
> `vercel.json` (crons, headers) is ignored.

| Setting | Value |
| --- | --- |
| Framework preset | Next.js |
| **Root Directory** | **`Frontend`** |
| Build command | `npm run build` (default) |
| Install command | `npm install` (default) |
| Node version | 20.x or newer |

## 2. Environment variables

Add these in **Vercel → Settings → Environment Variables**, for Production and
Preview. `.env.local` is not deployed.

### Required

| Variable | Where to get it |
| --- | --- |
| `NEXT_PUBLIC_APP_URL` | Your deployed origin, e.g. `https://book.example.com`. Used for notification links, canonical URLs and OG tags — a wrong value sends clients to the wrong host. |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API → Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Project Settings → API → anon public |
| `DATABASE_URL` | Supabase → Database → Connection string → **Transaction pooler** (port 6543) |
| `DIRECT_URL` | Supabase → Database → Connection string → **Session pooler** (port 5432) |
| `CRON_SECRET` | Generate: `openssl rand -hex 32`. Without it the cron route returns 401 and **no reminder is ever sent**. |

Both connection strings contain a `[YOUR-PASSWORD]` placeholder — replace it,
brackets included. `check:env` fails if the brackets survive.

### Optional

| Variable | Effect if unset |
| --- | --- |
| `RESEND_API_KEY` + `NOTIFICATIONS_FROM_EMAIL` | Email falls back to a console provider: messages are logged and marked sent, but nothing is delivered. **Both or neither** — half-configured is treated as an error. |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_SMS_FROM`, `TWILIO_WHATSAPP_FROM` | SMS and WhatsApp channels stay on the console provider. |
| `SUPABASE_SERVICE_ROLE_KEY` | `npm run db:claim` cannot resolve an email to a user id; pass the uuid instead. Never expose this key to the browser. |

## 3. Database

Migrations do not run automatically on deploy. From a machine with `DIRECT_URL`
pointing at production:

```bash
npm --prefix Frontend run db:migrate
```

Verify afterwards that RLS is on for all six tables and no `anon` policy
exists — the anon key is public, and RLS is the only thing standing between
tenants.

## 4. Supabase Auth

- **Authentication → URL Configuration → Site URL**: set to `NEXT_PUBLIC_APP_URL`.
- Add `https://<your-domain>/**` to the redirect allow-list.
- **Authentication → Providers → Email**: decide whether to keep email
  confirmation on. It is on by default; the signup flow handles that case and
  tells the user to check their inbox.

## 5. Cron

`vercel.json` schedules `/api/cron/notifications` every 15 minutes. Vercel
sends `Authorization: Bearer $CRON_SECRET` automatically once that variable is
set on the project.

Verify after the first deploy:

```bash
curl -s -H "Authorization: Bearer $CRON_SECRET" https://<your-domain>/api/cron/notifications
```

The response reports each channel's provider and whether it is `live`. If
`email` shows `"provider": "console"`, Resend is not configured and clients are
receiving nothing.

> Cron on Vercel's Hobby plan runs at most once per day, and only roughly on
> schedule. A 15-minute reminder cadence needs the Pro plan, or an external
> scheduler (cron-job.org, GitHub Actions) hitting the same URL with the same
> bearer token.

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
