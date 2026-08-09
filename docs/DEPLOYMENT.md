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
| `TWILIO_ACCOUNT_SID`            | twilio.com → Console → Account SID. **Newly required in production** — see below.                                                                              |
| `TWILIO_AUTH_TOKEN`             | twilio.com → Console → Auth Token.                                                                                                                             |
| `TWILIO_SMS_FROM`               | twilio.com → Phone Numbers, in E.164. Without it, Pro tenants silently fall back to email reminders.                                                            |
| `SUPABASE_SERVICE_ROLE_KEY`     | Supabase → Project Settings → API → **service_role**. Signs the upload URLs owners send images to. **Never expose it to the browser.** See §3.1.                |

Both connection strings contain a `[YOUR-PASSWORD]` placeholder — replace it,
brackets included. `check:env` fails if the brackets survive.

> **Why Twilio moved out of "optional".** The Pro tier now *sells* SMS
> reminders, and an unconfigured channel resolves to the console provider,
> which reports success and delivers nothing. Deploying without these keys
> would take money for reminders that never fire, so
> `check:env --production` fails on them — the same rule already applied to
> Resend. If you want to go live before opening a Twilio account, remove the
> SMS line from the Pro tier in `lib/plans.ts` first; then the check has
> nothing to enforce and the tier stops promising it.

### Optional

| Variable                    | Effect if unset                                                                                                                                                                            |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TWILIO_WHATSAPP_FROM`      | The WhatsApp channel stays on the console provider. Genuinely optional: reminders are never auto-routed to WhatsApp, because a business-initiated message needs a Meta-approved template. |
| `SUPER_ADMIN_EMAILS`        | `/master` denies everyone. The console is unreachable, which is the safe default — set it only when you want it.                                                                            |

## 3. Database

Migrations do not run automatically on deploy. From a machine with `DIRECT_URL`
pointing at production:

```bash
npm --prefix Frontend run db:migrate
```

> ⚠️ **Migration `0012` has never been applied to any database.** It widens the
> subscription status set, rewrites retired `business` plan rows up to `pro`,
> and creates `subscription_events` and `invoices`. Until it runs, the entire
> billing lifecycle is inert: no trial lapses, nothing is ever frozen, and
> `/dashboard/billing` cannot read its own tables.

Verify afterwards that RLS is on for all nine tables and that no policy is
reachable by `anon` — the anon key is public, and RLS is the only thing
standing between tenants:

```sql
-- Expect 9 rows, all rls_enabled = true.
select tablename, rowsecurity as rls_enabled
from pg_tables where schemaname = 'public' order by tablename;

-- Expect exactly one row: invoices / SELECT. Owners read their invoices and
-- never write them; anything else here means someone can mark themselves paid.
select tablename, cmd from pg_policies
where schemaname = 'public' and tablename = 'invoices';

-- Expect ZERO rows.
select tablename, policyname, roles from pg_policies
where schemaname = 'public' and roles::text[] && array['anon','public'];
```

`rate_limits` correctly shows RLS on with no policy at all; the other six each
have one `authenticated` owner policy.

> **Migration `0008` will refuse to apply if any business points at a deleted
> auth user.** It adds the owner FK, and it will not delete rows to make room
> for itself. Find them with the query below, then reassign `owner_user_id` to
> a live account or delete those businesses deliberately, and re-run.
>
> ```sql
> select b.slug, b.name, b.owner_user_id from businesses b
> left join auth.users u on u.id = b.owner_user_id where u.id is null;
> ```

### The platform console

`/master` is gated by `SUPER_ADMIN_EMAILS`, a comma-separated list of login
emails. It **fails closed**: unset, empty or whitespace denies everyone, so a
typo locks you out rather than opening the console.

Treat the roster as a privileged secret. Anyone on it can read every tenant's
client list, freeze any business, and impersonate any owner. Promotion requires
a redeploy, which is deliberate.

```bash
SUPER_ADMIN_EMAILS="owner@yourdomain.com"
```

Impersonation writes are attributed to the tenant, not to the admin — see the
warning in [ARCHITECTURE.md](ARCHITECTURE.md#impersonation) before handing the
roster to anyone but yourself.

### Deleting an owner account destroys their tenant

Once `0008` is applied, removing a user in **Authentication → Users** cascades
to their business and every appointment, client name and phone number under it.
There is no prompt and no undo. Delete test accounts freely before launch; once
real businesses exist, treat that button as destructive.

## 3.1 Storage — one command, once per project

Owners upload logos, banners, gallery images and staff portraits. That needs a
bucket, and **the bucket is not created by a migration**: Supabase Storage lives
in a `storage` schema that the PGlite test database does not have, so a
migration referencing it would break every test in the suite.

With `SUPABASE_SERVICE_ROLE_KEY` and `NEXT_PUBLIC_SUPABASE_URL` set:

```bash
npm --prefix Frontend run storage:setup
```

It is idempotent — safe to re-run, and re-running is how you repair a bucket
that was created by hand in the dashboard without limits. It creates
`business-media` as **public-read**, capped at **25MB**, restricted to
`image/jpeg, image/png, image/webp, image/avif, image/gif, video/mp4,
video/webm`.

> **Re-run it after upgrading to a build with video heroes.** A bucket created
> before that carries a 5MB limit and an image-only MIME list, so every video
> upload fails with a storage error rather than a message an owner can act on.
> The command is idempotent and repairing an existing bucket is exactly what it
> is for.

The bucket's 25MB is the ceiling for a hero **video**; images are held to 5MB by
the browser and by `requestMediaUploadAction`. One bucket carries one limit, so
the tighter image rule lives in the app — a crafted request could put a 20MB PNG
in a tenant's own folder, which costs storage rather than safety.

Those two bucket settings are the only size and type checks that actually
_enforce_ anything. The browser and the server action check the same rules first
to produce a fast, readable error, but both are skippable by a crafted request.

Public-read is deliberate: every one of these images is already displayed on an
unauthenticated booking page, so a signed read URL would protect nothing and
would expire inside a link meant to be shareable.

There are **no write policies to create**. Nothing ever authenticates to this
bucket as a user — uploads arrive on a signed URL minted server-side after the
same `requireWritable()` check every other dashboard mutation runs.

**Symptoms of skipping this step**

| What the owner sees                                     | Cause                                        |
| ------------------------------------------------------- | -------------------------------------------- |
| "העלאת קבצים לא מוגדרת עדיין בשרת"                      | `SUPABASE_SERVICE_ROLE_KEY` is not set        |
| "לא הצלחנו להתחיל את ההעלאה" on every attempt           | key is set, bucket was never created          |
| Upload reaches 100% then fails                          | bucket exists but has no `file_size_limit` / wrong mime list — re-run the command |

## 4. Supabase Auth

### 4.0 URL Configuration — get this wrong and every emailed link goes to `/`

**Authentication → URL Configuration.** Two fields, and they do different jobs:

| Field            | Value                                                              |
| ---------------- | ------------------------------------------------------------------ |
| **Site URL**     | `https://<your-domain>` — no trailing slash, no path               |
| **Redirect URLs** | `https://<your-domain>/**` (add one line per origin, see below)   |

> ### The failure this prevents
>
> **Site URL is the fallback, not the destination.** Supabase only honours a
> `redirect_to` that matches an entry in **Redirect URLs**. When it does not
> match, Supabase does not error and does not warn — it silently sends the user
> to the **Site URL** instead. The user clicks a reset link and lands on the
> home page, the token is spent, and nothing anywhere says why.
>
> **That is the whole diagnostic.** If a reset link drops someone on `/`, the
> destination was rejected by the allow-list. Check the three origins below
> agree before looking at anything in the application.

Three values must name the **same origin**, and a domain change breaks all
three at once:

1. `NEXT_PUBLIC_APP_URL` in Vercel — the app builds the reset link from this
   and **only** this (see [ARCHITECTURE.md](ARCHITECTURE.md#password-reset)).
2. **Redirect URLs** in Supabase — must match that link.
3. **Site URL** in Supabase — where a rejected link lands, so make it somewhere
   sensible even when everything else is right.

Add every origin that will ever send a reset, each on its own line:

```
https://<your-domain>/**
https://www.<your-domain>/**
http://localhost:3000/**
```

`**` matches across path separators, so one line per origin covers
`/auth/confirm?next=/login/reset` and every other callback. If you prefer to be
narrow, the exact URL the app sends is:

```
https://<your-domain>/auth/confirm?next=/login/reset
```

> **`www` and the apex are different origins to this allow-list.** If Vercel
> serves both and `NEXT_PUBLIC_APP_URL` names one, a visitor who typed the other
> is still fine — the app builds the link from the env var, not from the host
> they arrived on, precisely so the link always matches the allow-list. Listing
> both is belt and braces for the day someone changes the env var.
>
> **Preview deployments will not work**, and that is deliberate. Every preview
> gets a fresh `*.vercel.app` hostname that cannot be pre-allow-listed, so a
> reset requested from a preview builds a link to the production domain. Test
> password reset against production or locally, never on a preview.

- **Authentication → Providers → Email**: decide whether to keep email
  confirmation on. It is on by default; the signup flow handles that case and
  tells the user to check their inbox.

### Password reset needs two more settings, and both bite silently

**a. Point the recovery template at `{{ .TokenHash }}`.**
**Authentication → Emails → Reset Password**, change the link to:

```html
<a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/login/reset">
  איפוס הסיסמה
</a>
```

Note this one builds the URL from `{{ .SiteURL }}` — the template renders the
link itself rather than going through `redirect_to`, so **Site URL** has to be
the real domain for it to work, which is the other reason §4.0 matters.

The default template sends `{{ .ConfirmationURL }}`, which comes back as a PKCE
`code`. That code can only be redeemed by the browser that *asked* for the
reset, because the verifier lives in a cookie there. Request the reset on a
phone, open the mail on a laptop, and it fails — which is a very common way to
read email and an almost impossible bug to reproduce in development, where both
halves happen in one browser.

`/auth/confirm` accepts **both** shapes, so nothing breaks if you skip this. You
simply keep the same-device-only limitation until you make the change.

**b. Configure custom SMTP.** **Project Settings → Authentication → SMTP.**
Supabase's built-in sender is rate-limited to a handful of messages per hour
across the whole project and is explicitly not for production. Reset mail does
**not** go through this app's outbox or `RESEND_API_KEY` — Supabase Auth sends it
directly — so point Supabase's SMTP at the same Resend account:

| Field    | Value                                                   |
| -------- | ------------------------------------------------------- |
| Host     | `smtp.resend.com`                                       |
| Port     | `465`                                                   |
| Username | `resend`                                                |
| Password | your `RESEND_API_KEY`                                   |
| Sender   | the address in `NOTIFICATIONS_FROM_EMAIL`               |

Without this, an owner who forgets their password on a busy morning gets
nothing, and the app cannot tell — the send succeeded as far as it knows.

Reset links expire after one hour and are single-use. Both facts are stated on
screen, because "I clicked it twice" is otherwise indistinguishable from a
broken link.

### If a reset link misbehaves, in the order worth checking

| Symptom                                   | Cause                                                                        |
| ----------------------------------------- | ---------------------------------------------------------------------------- |
| Lands on **`/`**                          | `redirect_to` rejected → fell back to Site URL. §4.0: the three origins disagree. |
| Lands on **`/login/forgot?error=link`**   | The callback *was* reached and the token was refused — expired, already used, or the link was opened in a different browser while the template still sends a PKCE `code`. Fix with §a. |
| Lands on **`/login/reset`** saying the link is invalid | The exchange succeeded but no session arrived. Check `Set-Cookie` on the 307 from `/auth/confirm`. |
| **No email at all**                       | §b — Supabase's built-in SMTP is throttled project-wide.                     |

The distinction between the first two rows is the useful one: `/` means the
request never reached this application, so nothing in the code can be at fault.

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
- `/login/forgot` accepts an address and returns the same notice for a
  registered and an unregistered one — if they differ, the enumeration guard
  has regressed
- the reset mail actually arrives (this proves custom SMTP, not just the app),
  and its link opens `/login/reset` **in a different browser** from the one that
  requested it — that is the check for §4a
