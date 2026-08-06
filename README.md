# Bazman · בזמן

Multi-tenant appointment booking platform for small service businesses —
barbers, salons, clinics, studios. Hebrew / RTL, mobile-first.

Every business gets a public booking page at `/[slug]` that clients use without
creating an account, plus an owner dashboard at `/dashboard` for the calendar,
services, hours and settings. Notifications (confirmation, owner alert,
reminder, cancellation) are dispatched from a transactional outbox. The
platform owner gets a super-admin console at `/master`.

|                                 |                                              |
| ------------------------------- | -------------------------------------------- |
| Architecture & design decisions | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| Deploying to Vercel + Supabase  | [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)     |
| Scope, schema and roadmap       | [docs/PROJECT_PLAN.md](docs/PROJECT_PLAN.md) |

---

## What it does

**For the client** — opens the business link, picks a service, picks a slot,
enters name and phone. No registration. Gets a confirmation with an `.ics`
download and a personal link to cancel within the business's cancellation
window.

**For the owner** — day and week agenda, manual booking for walk-ins, quick
status actions (completed / no-show / cancel), services CRUD with per-service
buffer, weekly working hours with split shifts, one-off time off, a clients
list derived from booking history, and stats for today / this week /
cancellations / no-shows.

**Underneath**

- Availability is computed **server-side only**. The client never decides what
  is bookable; the server re-derives duration and re-runs availability before
  every insert.
- Double booking is prevented by a Postgres `EXCLUDE USING gist` constraint,
  not by application logic — two clients tapping the same slot at the same
  instant cannot both win.
- All timestamps are stored in UTC and reasoned about in the business
  timezone. DST transitions are covered by tests.
- Row Level Security is on for all 9 tables with **zero anon policies**, which
  is what keeps the public Supabase anon key from reading every tenant's client
  names and phone numbers.
- The public booking form carries a honeypot plus Postgres-backed rate limits
  on IP and on phone-per-business.

---

## Repository layout

```
.
├── Frontend/          the entire application — there is no separate backend tier
│   ├── src/
│   │   ├── app/       routes: /, /[slug], /b/[token], /dashboard/*, /master/*, /login, /api/cron
│   │   ├── components/  booking/, dashboard/, marketing/, master/, ui/
│   │   ├── db/        schema, migrations, queries/ (repository layer), scripts
│   │   │              queries/admin.ts — the only cross-tenant queries
│   │   ├── lib/       availability, notifications/, stats, rate limiting, env, ics
│   │   │              branding, plans, platform-metrics, super-admin, impersonation
│   │   ├── test/      PGlite harness + factories
│   │   └── proxy.ts   auth redirect guard (Next 16 deprecates middleware.ts)
│   ├── e2e/           Playwright specs
│   ├── next.config.ts security headers
│   └── vercel.json    cron schedule + function limits
└── docs/              architecture, deployment, project plan
```

Server Actions and route handlers _are_ the backend. Every command below runs
from `Frontend/`, or from the root with `npm --prefix Frontend run <script>`.

---

## Quickstart

Requires **Node 20+** (developed on 24.x) and a Supabase project.

```bash
cd Frontend
npm install
cp .env.example .env.local
```

Fill in `.env.local` — at minimum `NEXT_PUBLIC_APP_URL`,
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `DATABASE_URL`,
`DIRECT_URL` and `CRON_SECRET`. Add `SUPER_ADMIN_EMAILS` if you want the
`/master` console — it denies everyone while unset. Then:

```bash
npm run check:env
```

Apply migrations and seed the demo shop:

```bash
npm run db:migrate
npm run db:seed
npm run dev
```

Open <http://localhost:3000> for the landing page and
<http://localhost:3000/demo-barber> for a live booking page.

To use the dashboard, sign up at `/login`, confirm the email, then point the
demo business at your account:

```bash
npm run db:claim -- <your-auth-user-uuid>
```

> `db:seed` deletes and recreates the demo business, which resets its owner —
> re-run `db:claim` afterwards.

Notifications work out of the box without any provider account: every channel
falls back to a console provider that logs the message and marks it sent. Add
`RESEND_API_KEY` + `NOTIFICATIONS_FROM_EMAIL` to make email real, and the
`TWILIO_*` keys to make SMS real. All are required for production and
`check:env --production` fails without them — a channel a tier *sells* must
not resolve to a provider that delivers nothing.

---

## Scripts

Run from `Frontend/`.

### Develop & build

| Script          | Purpose                             |
| --------------- | ----------------------------------- |
| `npm run dev`   | Dev server (Turbopack) on port 3000 |
| `npm run build` | Production build                    |
| `npm run start` | Serve the production build          |

### Quality

| Script                 | Purpose                                              |
| ---------------------- | ---------------------------------------------------- |
| `npm run verify`       | **The gate.** env → lint → typecheck → tests → build |
| `npm run test`         | Vitest, one pass                                     |
| `npm run test:watch`   | Vitest, watch mode                                   |
| `npm run test:e2e`     | Playwright (needs a live server + DB)                |
| `npm run test:e2e:ui`  | Playwright interactive runner                        |
| `npm run lint`         | ESLint                                               |
| `npm run typecheck`    | `tsc --noEmit`                                       |
| `npm run format`       | Prettier write                                       |
| `npm run format:check` | Prettier check (CI)                                  |

### Database & environment

| Script                       | Purpose                                                   |
| ---------------------------- | --------------------------------------------------------- |
| `npm run check:env`          | Validate env vars; `-- --production` for deploy-readiness |
| `npm run db:migrate`         | Apply SQL migrations via `DIRECT_URL`                     |
| `npm run db:generate`        | Generate a migration from schema changes                  |
| `npm run db:push`            | Push schema without a migration (dev only)                |
| `npm run db:studio`          | Drizzle Studio                                            |
| `npm run db:seed`            | Reset and seed the `demo-barber` business                 |
| `npm run db:claim -- <uuid>` | Point the demo business at a real auth user               |

---

## Tech stack

| Layer          | Choice                                                                      |
| -------------- | --------------------------------------------------------------------------- |
| Framework      | Next.js 16 (App Router, Turbopack), React 19, TypeScript strict             |
| Styling        | Tailwind CSS v4, lucide-react — no component library                        |
| Font           | Heebo via `next/font` (Hebrew + Latin)                                      |
| Database       | Supabase Postgres, Drizzle ORM, postgres.js driver                          |
| Auth           | Supabase Auth (`@supabase/ssr`); owners by session, `/master` by env roster |
| Validation     | Zod v4 shared client/server, react-hook-form on the public form             |
| Dates          | date-fns + date-fns-tz                                                      |
| Email          | Resend (falls back to a console provider)                                   |
| SMS / WhatsApp | Twilio adapters — code-complete, unproven                                   |
| Unit tests     | Vitest against PGlite (WASM Postgres) running the real migrations           |
| E2E            | Playwright, Chromium                                                        |
| Hosting        | Vercel — **Root Directory must be `Frontend`**                              |

---

## Routes

| Route                     | Access        | Notes                                           |
| ------------------------- | ------------- | ----------------------------------------------- |
| `/`                       | public        | Marketing landing page, static, no DB, monochrome |
| `/[slug]`                 | public        | Booking flow: service → date & time → details   |
| `/b/[token]`              | token         | Self-service cancellation, `noindex`            |
| `/login`                  | public        | Owner sign-in / sign-up                         |
| `/dashboard`              | owner         | Day & week agenda, stats, manual booking        |
| `/dashboard/services`     | owner         | Services CRUD                                   |
| `/dashboard/hours`        | owner         | Weekly hours + time off                         |
| `/dashboard/clients`      | owner         | Derived from booking history                    |
| `/dashboard/settings`     | owner         | Business profile and booking rules              |
| `/dashboard/billing`      | owner         | Plan, status, grace deadline, invoices          |
| `/dashboard/setup`        | owner         | 5-step onboarding, incl. plan selection         |
| `/master`                 | super admin   | Platform overview: tenants, MRR, conversion     |
| `/master/businesses`      | super admin   | Tenant table: impersonate, extend trial, freeze |
| `/master/live`            | super admin   | Global booking feed across all tenants          |
| `/master/alerts`          | super admin   | Churn risk, expiring trials, failed sends       |
| `/api/cron/notifications` | `CRON_SECRET` | Dispatches the outbox on a schedule             |

`/dashboard/*` and `/b/*` send `X-Robots-Tag: noindex` and
`Cache-Control: private, no-store`; security headers are set globally in
`next.config.ts` so they apply in dev too. `/master` is `noindex` in its own
metadata and is guarded server-side in its layout, in every page **and** in
every action — see [ARCHITECTURE.md](docs/ARCHITECTURE.md#platform-console-master).

---

## Testing

```bash
npm run verify     # env, lint, types, 324 unit tests, build
npm run test:e2e   # 10 Playwright specs, separate — needs a running server
```

Unit tests run against **PGlite applying the real migration files**, so the
exclusion constraint, enum casts and RLS policies are genuinely exercised
rather than mocked.

The E2E suite books against `demo-barber` and tags every row it creates with
the phone number `0559990001`, which is all teardown deletes. The dashboard
specs need `E2E_EMAIL` / `E2E_PASSWORD` for a confirmed owner account in
`.env.local`; without them those specs skip and the public ones still run.

> **Known gap:** PGlite is more forgiving than postgres.js about parameter
> binding, so the suite proves SQL _semantics_, not driver binding. Aggregate
> `sql` templates need a smoke test against real Supabase after changes.

---

## Deployment

Full checklist in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). The four that bite
hardest:

1. **Vercel Root Directory must be `Frontend`.** Otherwise the build fails with
   "No Next.js version detected" and `vercel.json` is ignored.
2. **Migrations do not run on deploy.** Run `npm run db:migrate` against
   production yourself.
3. **Vercel Hobby rejects sub-daily cron at build time.** The schedule is
   therefore daily, which delays every confirmation email by up to a day.
   Restoring a useful cadence needs Pro or an external scheduler.
4. **Without Resend configured, email silently goes nowhere.** Messages are
   logged and marked sent. `check:env --production` fails on this.

Run `npm run check:env -- --production` before every deploy.

---

## Status

Feature-complete through **Phase 7** (super-admin console), plus **stage 8a**
of the billing milestone. Shipped since the MVP: per-business branding,
subscription plans and pricing, the Bazman brand rollout, `/master`, a
two-tier plan line whose entitlements are enforced server-side, and a
monochrome rebuild of the landing page.

> The landing page is now a monochrome surface with a single violet-to-blue
> accent gradient, while `/login`, `/dashboard/*` and `/master` still use the
> teal chrome. The two look like different products until that is reconciled in
> one pass. See
> [ARCHITECTURE.md](docs/ARCHITECTURE.md#the-landing-page-is-monochrome-plus-one-gradient-nothing-else-is).

**The milestone in progress is billing.** Plans are enforced and the lifecycle
runs: a trial hands over the full Pro product, a lapsed trial drops to
`past_due`, the owner gets warned at T-3 and T-1, paid features switch off, and
after a 7-day grace window the tenant is frozen — public page offline,
dashboard read-only. The checkout path, the activation and the invoice trail
are built and tested behind a provider adapter.

What is missing is **an implementation of that adapter that talks to a payment
company**, plus its webhook. Until one exists the console provider refuses in
production, so nothing can be marked paid without money moving. Stages 8d–8e —
see [docs/PROJECT_PLAN.md](docs/PROJECT_PLAN.md#phase-8--billing-in-progress).

Still not built: payments/deposits, multi-staff resources, Google Calendar
sync, recurring appointments, custom domains, service image upload (needs
Supabase Storage), Sentry.

> **Deploy note:** the Pro tier sells SMS reminders, so
> `check:env --production` now requires Twilio credentials. Without a Twilio
> account, either add one or drop the SMS line from the Pro tier in
> `lib/plans.ts` before deploying.
