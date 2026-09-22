# PROJECT PLAN — Bazman · בזמן

Multi-tenant booking platform. Each business gets a public mobile-first booking page at `/[business_slug]` plus an admin dashboard at `/dashboard`.
Reference model: Noah Calendar (Hebrew / RTL, service → date → time → confirm).

---

## 1. Core Features (MVP)

### Public Booking Page — `/[business_slug]`

- Business header: logo, name, cover image, short description.
- **Step 1 — Service**: list of services with image, duration, price.
- **Step 2 — Date & Time**: month/week date picker; available slots computed from working hours − existing appointments − blocked time.
- **Step 3 — Details & Confirm**: name, phone, email (optional), notes → summary → confirm.
- No client registration required (phone number is the identity).
- Confirmation screen + "add to calendar" (.ics) link.
- Self-service cancel/reschedule via signed link (`/b/[token]`).
- Mobile-first, RTL-ready (Hebrew), fast (SSR + cached availability).
- Optional gallery section ("our work") and business contact/social links.

### Admin Dashboard — `/dashboard`

- Auth (email magic link / OTP) scoped to a single business.
- **Calendar view**: day / week list of appointments; create, edit, cancel manually.
- **Services CRUD**: name, duration, price, description, image, active toggle.
- **Working hours**: per weekday open/close + breaks; slot interval; booking buffer.
- **Time off / blocked dates**: vacations, one-off closures.
- **Settings**: business name, slug, logo, phone, address, timezone, cancellation window, min/max advance booking.
- **Clients list**: derived from appointments (name, phone, visit history).
- Basic stats: appointments today / this week, no-show & cancellation counts.

### Notifications (MVP-lite)

- Email confirmation to client + notification to business owner on new booking/cancellation.
- Reminder job (N hours before appointment) via cron.
- Provider-agnostic adapter so WhatsApp/SMS can be plugged in post-MVP.

### Explicitly out of MVP (post-launch)

Online payments/deposits, multi-staff resources, Google Calendar 2-way sync, AI chatbot, marketing automation, reviews, recurring appointments, custom domains.

---

## 2. Recommended Tech Stack

| Layer         | Choice                                                               | Why                                                                                                                    |
| ------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Framework     | **Next.js 15+ (App Router)** — RSC + Server Actions                  | SSR public pages, one codebase for API + UI                                                                            |
| Language      | **TypeScript** (strict)                                              | Type safety end-to-end                                                                                                 |
| Styling       | **Tailwind CSS v4** + shadcn/ui + Radix                              | Fast, consistent, RTL via logical properties                                                                           |
| DB            | **PostgreSQL (Supabase)**                                            | Managed, pooled, backups, generous free tier                                                                           |
| ORM           | **Drizzle ORM** + drizzle-kit migrations                             | Fast, edge-friendly, SQL-first, zero runtime bloat _(Prisma is the acceptable alternative if the team prefers its DX)_ |
| Auth          | **Supabase Auth** (magic link / OTP) — owners only                   | Clients book without accounts                                                                                          |
| Validation    | **Zod** (shared client/server schemas)                               | Single source of truth for forms + API                                                                                 |
| Dates         | **date-fns** + `date-fns-tz`                                         | Timezone-correct slot math                                                                                             |
| Forms         | React Hook Form + Zod resolver                                       | Minimal re-renders                                                                                                     |
| State/Data    | Server Components + Server Actions; TanStack Query only where needed | Less client JS                                                                                                         |
| Files         | Supabase Storage                                                     | Logos, service & gallery images                                                                                        |
| Email         | Resend + React Email                                                 | Confirmations & reminders                                                                                              |
| Jobs/Cron     | Vercel Cron (or Supabase pg_cron)                                    | Reminder dispatch                                                                                                      |
| Hosting       | Vercel                                                               | Edge CDN, preview deploys                                                                                              |
| Quality       | ESLint + Prettier, Vitest (slot logic), Playwright (booking flow)    | Guard the critical path                                                                                                |
| Observability | Sentry + Vercel Analytics                                            | Errors + funnel drop-off                                                                                               |

**Key conventions**

- Store all timestamps in **UTC**; render in `business.timezone`.
- Multi-tenancy by `business_id` on every row; enforce with RLS + app-layer scoping.
- Slot generation is **server-side only** — never trust client-computed availability.

---

## 3. Database Schema (concise)

> ⚠️ **This section is the original design sketch and has drifted a long way.**
> It predates migrations `0003`–`0020`, so it omits per-service buffers, the
> notifications outbox, rate limits, onboarding state, branding, subscription
> and trial columns, the whole of multi-staff (`staff`, `staff_schedules`,
> `appointments.staff_id`, `time_off.staff_id`), deposits, social links,
> `requires_approval`, and `push_subscriptions`.
>
> **`Frontend/src/db/schema.ts` is the source of truth**, and
> [ARCHITECTURE.md](ARCHITECTURE.md#database) documents the constraints that
> carry weight. Kept here for the original reasoning, not as a reference —
> including the last note below, which predicted the multi-staff change and is
> worth reading against what it actually took.

```
businesses
  id            uuid pk
  owner_user_id uuid            -- FK auth.users
  slug          text unique     -- /[business_slug]
  name          text
  description   text?
  logo_url      text?
  phone         text?
  address       text?
  timezone      text            -- e.g. 'Asia/Jerusalem'
  locale        text            -- 'he' | 'en'
  slot_interval_min      int    -- default 15
  buffer_min             int    -- default 0, gap after each appointment
  min_notice_min         int    -- earliest bookable
  max_advance_days       int    -- booking horizon
  cancel_window_hours    int
  is_active     bool
  created_at    timestamptz

services
  id            uuid pk
  business_id   uuid fk -> businesses (cascade)
  name          text
  description   text?
  duration_min  int
  price_cents   int
  currency      text            -- 'ILS'
  image_url     text?
  sort_order    int
  is_active     bool
  created_at    timestamptz
  idx (business_id, is_active)

working_hours                    -- weekly recurring template
  id            uuid pk
  business_id   uuid fk -> businesses (cascade)
  weekday       smallint         -- 0=Sun .. 6=Sat
  start_time    time             -- local to business timezone
  end_time      time
  is_closed     bool
  unique (business_id, weekday, start_time)   -- multiple rows = split shifts

time_off                         -- one-off closures / breaks
  id            uuid pk
  business_id   uuid fk -> businesses (cascade)
  starts_at     timestamptz
  ends_at       timestamptz
  reason        text?

appointments
  id                uuid pk
  business_id       uuid fk -> businesses (cascade)
  service_id        uuid fk -> services (restrict)
  starts_at         timestamptz      -- UTC
  ends_at           timestamptz      -- UTC (derived from service duration)
  status            enum('pending','confirmed','cancelled','completed','no_show')
  client_name       text
  client_phone      text
  client_email      text?
  notes             text?
  price_cents       int              -- snapshot at booking time
  cancel_token      text unique      -- self-service cancel/reschedule link
  reminder_sent_at  timestamptz?
  created_at        timestamptz
  idx (business_id, starts_at)
  exclusion constraint: no overlapping [starts_at, ends_at) per business_id
    where status in ('pending','confirmed')   -- DB-level double-booking guard
```

**Notes**

- Postgres `EXCLUDE USING gist (business_id WITH =, tstzrange(starts_at, ends_at) WITH &&)` is the authoritative anti-double-booking guard; the UI check is only an optimization.
- Snapshot `price_cents` / service name on the appointment so history survives service edits.
- Add `staff` + `appointments.staff_id` later without breaking this model.
  > **How that actually went (0013).** The model held, but the guard above did
  > not: the exclusion constraint had to be **rekeyed** onto
  > `(business_id, staff_id)`, added while the old one still stood and dropped
  > only afterwards so the table was never unguarded. Its predicate was also
  > inverted to list the statuses that *release* a slot, which is what later
  > let two new enum values be added without naming them anywhere.

---

## 4. Development Roadmap

### Phase 0 — Foundation ✅

- [x] `create-next-app` (TS, App Router, Tailwind), ESLint/Prettier, strict `tsconfig`.
- [x] Supabase project; connection strings in `.env.local` + `.env.example`.
- [x] Drizzle schema + first migration; seed script (1 demo business, 3 services, working hours).
- [x] Base layout: RTL support, fonts, shadcn/ui init, theme tokens. _(Heebo via next/font; `dir="rtl"`. shadcn/ui not initialised — components written directly against Tailwind so far.)_

### Phase 1 — Data & Availability Engine (the core) ✅

- [x] Repository/query layer scoped by `business_id`. _(`src/db/queries/`, driver-agnostic `Database` handle.)_
- [x] `getAvailableSlots({ businessId, serviceId, date })`: working hours → subtract booked + time_off → apply buffer, min notice, max advance → return slot list. _(`src/lib/availability.ts`; takes `db` as first arg for injectability.)_
- [x] Unit tests: DST boundary, split shifts, back-to-back bookings, closed days, buffer edges. _(24 tests on PGlite running the real migrations.)_
- [x] Add overlap exclusion constraint + booking transaction that fails cleanly on conflict. _(`0001_double_booking_guard.sql`, live on Supabase.)_
- [x] **Added:** tenant-isolation RLS on all 5 tables, zero anon policies (`0002_tenant_isolation_rls.sql`). Pulled forward from Phase 5.

### Phase 2 — Public Booking Page ✅

- [x] `/[business_slug]` route: fetch business + active services (404 on unknown/inactive slug).
- [x] Step 1 — service list UI (image, duration, price).
- [x] Step 2 — date picker + slot grid (server-fetched availability, loading/empty states). _(Horizontal day strip instead of a month grid — better for thumbs.)_
- [x] Step 3 — details form (Zod + RHF) → Server Action `createAppointment` (re-validates slot server-side).
- [x] Confirmation screen + `.ics` download.
- [x] `/b/[cancel_token]` — view and cancel within the cancellation window. _(Reschedule deferred: it is a re-book, so it belongs with the Phase 3 admin edit flow.)_
- [x] Mobile polish, RTL pass, SEO/OG tags per business.

### Phase 3 — Admin Dashboard ✅

- [x] Supabase Auth + guard; `/dashboard` shell + business resolution from session. _(Email/password rather than magic link — no SMTP configured. Guard lives in `src/proxy.ts`; `middleware` is deprecated in Next 16. Verified end to end against the live project.)_
- [x] Appointments: day **and week** view, manual create (walk-ins), cancel / completed / no-show. _(Status filters not built.)_
- [x] Services CRUD **incl. per-service buffer** (`0003_service_buffer.sql`; NULL inherits the business default). _(No image upload to Supabase Storage yet.)_
- [x] Working hours editor (weekday rows, split shifts, closed = no shifts).
- [x] Time off manager.
- [x] Settings page — name, slug (uniqueness-checked), phone, address, description, default buffer, cancellation window. _(Timezone is displayed read-only; logo upload waits on Storage.)_
- [x] Clients list derived from appointment history (name, phone, bookings, last visit).
- [x] **Added:** `/dashboard/setup` onboarding + `npm run db:claim` to point the demo shop at a real auth user. Pulled forward from Phase 5.
- [x] **Added:** toast notifications, empty states, loading states across the dashboard.
- [ ] Deferred: service image upload (needs Supabase Storage), appointment status filters, timezone editing.

### Phase 4 — Notifications ✅

- [x] Email adapter (Resend) + Hebrew templates: client confirmation, owner alert, cancellation, reminder. _(Plain-text templates wrapped in minimal RTL HTML rather than React Email — one template set serves email, SMS and WhatsApp.)_
- [x] `/api/cron/notifications` — dispatches due messages, idempotent. _(Uses a `notifications` outbox table with a unique `dedupe_key`, not `appointments.reminder_sent_at`; the column is now unused. Scheduled via `vercel.json`, guarded by `CRON_SECRET`; daily on Hobby, which rejects sub-daily expressions at build time.)_
- [x] Notification interface ready for a WhatsApp/SMS provider. _(Twilio adapters written for both; they activate when their keys are present. Every channel falls back to a console provider when unconfigured.)_
- [x] **Added:** reminders are cancelled when their appointment is, and the dispatcher re-checks appointment state before sending.
- [x] **Added:** RLS on `notifications` (`0005_notifications_rls.sql`) — it stores client emails and phone numbers.
- [ ] Deferred: switching client messages to SMS/WhatsApp is a one-line channel change in `enqueue.ts` once Twilio keys exist.
- [ ] Deferred: drop the now-unused `appointments.reminder_sent_at` column.

### Phase 5 — Onboarding & Multi-tenant Polish

- [x] Sign-up flow: create business → pick slug → services → working hours → live link. _(4 steps at `/dashboard/setup`; business created at step 1 so an abandoned signup still leaves a usable account; `onboarding_completed_at` gates re-entry.)_
- [x] Enable RLS policies on all tables; verify cross-tenant isolation with tests. _(Pulled forward to Phase 1; migrations `0002` + `0005`, 6/6 tables, 0 anon policies.)_
- [x] Dashboard stats cards (today / week / cancellations / no-shows). _(Business-local day/week boundaries; rates measured only against appointments that have already started.)_
- [x] Basic marketing landing page at `/`. _(Static RSC, zero DB access: hero, live-demo banner, how-it-works, feature grid, footer. Hebrew OG/canonical metadata.)_

> Note: the deploy-readiness work (env checks, security headers, `vercel.json`)
> was done ahead of schedule and belongs to Phase 6, not here. SEO belonged to
> Phase 2 and is complete.

### Phase 6 — Ship

- [x] Playwright E2E: booking flow + dashboard verification + cancel flow. _(11 tests across 3 spec files in `e2e/`; self-cleaning via a marker phone number. Admin CRUD is still covered only by the PGlite suite, not through the browser.)_
- [x] Rate limiting on booking endpoint, honeypot/anti-spam on the public form. _(Postgres fixed-window counters, `0007`; IP + phone-per-business layers; honeypot returns fabricated success.)_
- [x] Structured error reporting at every server boundary (`src/lib/observability.ts`), with client identifiers redacted. _(**Sentry SDK not installed** — `reportError` is the single call site to wire it into.)_
- [x] **Added:** security headers moved from `vercel.json` to `next.config.ts`, so they apply in dev and on any host — and are testable locally.
- [ ] Production deploy to Vercel, custom domain, DB backups verified.
- [ ] Pilot with 1–2 real businesses; collect feedback before building payments/staff/WhatsApp.

### Phase 7 — Brand, branding and the platform console ✅

- [x] Per-business branding: accent theme, hero image/video, gallery with lightbox, owner-entered reviews (`0009`). _(Theme is a `data-accent` attribute plus CSS custom properties — Tailwind cannot emit a class from a runtime value. Every swatch is WCAG AA verified.)_
- [x] Landing page rebuilt: split hero, animated `Bazman.` / `בזמן.` wordmark, dashboard mockup, pricing table with a monthly/yearly toggle, FAQ accordion. _(`/` stays a static prerender; the toggle and accordion are client islands.)_
  - [x] **Rebuilt again after stage 8a.** Monochrome base, 70/30 above-the-fold split, feathered ink/paper hero: a Canvas field of hollow drifting bubbles and the typed wordmark on ink, the agenda preview and the actions on paper. One accent gradient (violet into blue) reserved for active and primary states, soft geometry throughout, and a gradient closing banner with a dot matrix, a warm flare and floating glass tiles. Teal was gone from `/` and still present on `/login`, `/dashboard/*` and `/master` — since closed by the palette reconciliation below. See [ARCHITECTURE.md](ARCHITECTURE.md#one-palette-one-ramp).
- [x] Subscription plans recorded on the tenant (`0010`) and selectable during onboarding, which is now five steps.
- [x] Global rename to **Bazman / בזמן**, with the name centralised in `lib/brand.ts`.
- [x] Dashboard overhaul: shared chrome (teal at the time, monochrome since), mobile bottom nav, revenue and new-client stats, clients search with call/WhatsApp shortcuts.
- [x] **Super-admin command center at `/master`** — four tabs (סקירה / עסקים / פעילות בלייב / התראות) over `db/queries/admin.ts`.
  - [x] Access by `SUPER_ADMIN_EMAILS` env roster. Fails closed: an empty or unset roster denies everyone. A column was rejected — super-admin is a property of a _user_, and users live in Supabase's `auth.users`, which this app must not alter.
  - [x] Guarded in the layout, in every page **and** in every action. A layout alone is not a boundary: a client navigation between tabs reuses it without re-running it.
  - [x] Overview: tenant breakdown by status, platform booking pulse, MRR and trial-conversion. Conversion excludes the still-trialing cohort from its denominator.
  - [x] Businesses: searchable tenant table with impersonation, `+7 days` trial extension and freeze/unfreeze.
  - [x] Impersonation keeps the admin's own identity — a cookie holding only a business id, re-verified against the roster on every request. Minting a real Supabase session for the target owner was rejected: it would make the admin indistinguishable from the tenant in Supabase's own auth logs.
  - [x] Live feed across all tenants, deliberately excluding client names and phone numbers.
  - [x] Alerts: churn risk (7 quiet days), trials expiring within 48h, failed notification deliveries.
  - [x] Trial clock (`0011`, `trial_ends_at`), backfilled for existing trialing tenants.
- [ ] Deferred: impersonation is **not read-only**. `requireBusiness()` is the one boundary every dashboard action shares, so an impersonating admin can write as the tenant. Needs a per-action gate — half-covering it would be worse than not doing it.

### Phase 8 — Billing (in progress)

Money was **recorded but not enforced**. Stage 8a closed the enforcement half:
features are now gated on the subscription columns. The collection half — a
payment provider, a lifecycle driven by webhooks, and a job that acts on a
lapsed trial — is stages 8b–8e.

**Decisions taken (2026-08-05), previously blocking:**

| Question           | Decision                                                                                                 |
| ------------------ | -------------------------------------------------------------------------------------------------------- |
| Tier line          | **Two tiers**: Starter ₪69/mo, Pro ₪99/mo. `business` retired and folded into `pro`.                    |
| Volume caps        | **None.** Both tiers include unlimited bookings; differentiation is by feature only.                     |
| Unpaid tenants     | **7-day grace** (downgrade + warnings), then **freeze**: public booking off, dashboard read-only.        |
| Multi-staff copy   | **Removed** — it did not exist at the time. ~~Superseded:~~ multi-staff shipped in Phase 9 and is now Basic-tier copy. |
| Payment provider   | **Deferred by design.** Build the adapter and a console provider; the concrete provider is one file.     |

Sequencing is deliberate: only 8d needs the provider decision, so everything
else ships before a merchant account exists.

#### 8a — Plans & entitlements ✅

- [x] Two-tier line in `lib/plans.ts` at ₪69 / ₪99. Booking-cap copy removed;
      a test asserts no tier feature can reintroduce one.
- [x] `lib/entitlements.ts` — pure, no IO, the single place deciding what a
      tier buys. Takes the business row rather than a `PlanType`, so no caller
      can consult the plan without the status.
- [x] Enforced: branding writes in `settings/appearance-actions.ts` (the
      boundary) with an upgrade panel on the settings page (the courtesy), and
      the client reminder channel in `lib/notifications/enqueue.ts`.
- [x] `past_due` taught to the code ahead of the migration that allows it, so
      it can never normalise into a status that grants paid features. Retired
      `business` maps **up** to `pro`, never down to the default.
- [x] Unknown status fails closed, unknown plan fails open — see
      [ARCHITECTURE.md](ARCHITECTURE.md#entitlements) for why they differ.
- [x] Twilio moved to a production requirement: a tier that sells SMS must not
      deploy onto a console provider that reports success and delivers nothing.
- [x] 18 new unit tests; `npm run verify` green at 270.

> Known consequence, accepted: **for a Starter tenant, entitlements change
> nothing.** Everything Starter sells is baseline product, so the grace window
> applies no pressure and the 8b freeze is their only real enforcement.

#### 8b — Lifecycle & the write gate ✅

- [x] Migration `0012`: `past_due` added to the status CHECK; legacy `business`
      rows rewritten **up** to `pro` and dropped from the plan CHECK;
      `grace_started_at`, `frozen_reason`, `billing_cycle`,
      `provider_customer_id`, `provider_subscription_id`, `current_period_end`,
      `cancel_at_period_end` added.
- [x] New tables `subscription_events` (UNIQUE `(provider, provider_event_id)`,
      scoped by provider because two providers mint the same opaque ids; RLS on
      with **zero** policies) and `invoices` (RLS **`FOR SELECT` only** — an
      owner who could `INSERT` could mark themselves paid). Invariant now
      **9 of 9 tables, 0 anon policies**, asserted by `db/rls.test.ts`.
- [x] `lib/billing/lifecycle.ts` — the state machine as pure functions. Freeze
      is last not first, one action per tenant per run, half-open warning bands,
      and `past_due` with no clock is never frozen.
- [x] `requireBusiness()` returns `access`; `requireWritable()` guards every
      mutating dashboard action and redirects rather than throwing.
- [x] **Coverage test over every `"use server"` module.** Verified by reverting
      three actions to `requireBusiness()` and confirming it named all three.
      A stale-exemption test keeps the waiver list honest.
- [x] Trial sweep riding the existing daily cron: warn at T-3 and T-1, lapse to
      `past_due` with the clock, freeze after 7 days. Only
      `frozen_reason = 'billing'` is ever auto-unfrozen. Runs *before* dispatch
      so a warning queued this run goes out this run.
- [x] `/master` breakdown gains a `past_due` bucket; trial conversion still
      excludes it, because a tenant mid-grace has not decided.
- [x] **Pulled forward from 8c:** the dispatcher's appointment-optional path
      and the four billing `notification_kind` values. Without them the sweep's
      warnings would have inserted cleanly and vanished, so shipping the sweep
      without the fix would have been shipping a silent failure.
- [x] **Pulled forward from 8c:** a read-only `/dashboard/billing`, because the
      freeze banner and the branding upsell both needed a real destination.

#### 8c — Payment adapter ✅

- [x] **Trial entitlement fix (found before starting 8c).** A trial now grants
      `TRIAL_PLAN` (Pro) whatever tier was picked at signup. Previously a
      tenant who chose Basic hit "upgrade your plan" walls on branding and
      gallery during the exact window they were evaluating, and
      `/dashboard/billing` labelled them בסיסי while they held Pro features.
- [x] **Trial clock fix (found while fixing the above).** Nothing ever wrote
      `trial_ends_at` on signup: `0011` backfilled existing rows and `/master`
      could extend it, but new tenants got NULL. The sweep only considers rows
      with a clock, so **every account created since launch was invisible to
      the entire 8b lifecycle** — never warned, never lapsed, never frozen. It
      is now set at business creation.
- [x] `/dashboard/billing` shows the tier actually held, the post-trial price,
      and a countdown derived from the tenant's own `trial_ends_at` rather than
      the `TRIAL_DAYS` constant — a trial extended from `/master` is longer
      than the constant, and printing it told that owner the wrong date.
- [x] `lib/billing/types.ts` + `providers.ts` — `BillingProvider` resolved at
      call time, with a console provider that **hard-refuses in production**.
      Asserted by test: the inverted fallback is the point.
- [x] `activateSubscription()` — the one place a subscription becomes active.
      Clears the grace clock, writes invoice and audit rows idempotently, and
      lifts only a `billing` freeze. Nine PGlite tests over the real tables.
- [x] Checkout and cycle-change UI on `/dashboard/billing`, with buttons
      disabled and the reason stated while no provider is configured.
- [x] `check:env` reports the resolved billing provider beside the email
      channel. Deliberately not a hard error yet: nothing can be configured
      until 8d, and the runtime refusal is the real guard.

#### Alpha feedback pass (between 8c and 8d) ✅

Four issues from real business owners testing the product.

- [x] **Share links pointed at localhost.** `lib/app-url.ts` resolves the origin
      from the request when the env is unset or still says localhost, with a
      `window.location.origin` backstop in the copy-link step. A runtime origin
      never overrides a real configured domain.
- [x] **Manual bookings appeared not to notify.** The action always enqueued;
      the real cause is that a phone booking has no email, and email is the
      only live channel, so nothing was queued at all. Now reported to the
      owner instead of silent. Confirmations also dispatch inline rather than
      waiting for the daily cron.
- [x] **Sticky `0` in price and duration.** Numeric drafts are strings so a
      field can be blank, and select on focus so the first keystroke replaces.
- [x] **Android RTL time picker clipped.** `dir="ltr"` on every time input.

#### Navigation performance pass ✅

- [x] **Root cause: no `loading.tsx` on any dynamic route.** Next skips
      prefetching dynamic routes without one, so every navigation waited on a
      full server render before painting. Measured: the prefetch payload for
      `/demo-barber` went from 197 bytes to 11,896 with the skeleton included.
- [x] `loading.tsx` for all seven dashboard routes, all four `/master` tabs and
      the public booking page, each shaped like its real page.
- [x] `RouteProgress` top bar, rendered by the fallbacks so Suspense drives it
      rather than router events. Server component, no JavaScript.
- [x] `useLinkStatus` indicators on the sidebar, covering the moment before the
      fallback paints.
- [x] `SubmitButton` (`useFormStatus`) for the two form-action buttons that had
      no pending state. The rest already had `useTransition` guards.

#### Password reset ✅

The gap an owner could not work around: forgetting a password meant losing the
account, because there is no support inbox and impersonation deliberately mints
no session for the owner. `signUpAction` had been telling people to "sign in or
reset your password" since launch, pointing at a flow that did not exist.

- [x] `/login/forgot` → emailed link → `/auth/confirm` → `/login/reset`, reusing
      `AUTH_RULES`, `authIdentifier` and the sign-up strength rules rather than
      restating any of them.
- [x] **One response, always.** A reply that varies with whether the address is
      registered turns the form into a membership oracle. Only a transport
      failure is reported honestly, because it says nothing about the address.
- [x] `resetIdentity` rate limit, tighter than sign-in's, keyed on the hashed
      address. It guards a *mailbox*: a reset cannot be guessed, so the abuse
      case is using this form to bomb someone else's inbox.
- [x] `/auth/confirm` accepts **both** the `token_hash` and PKCE `code` link
      shapes. PKCE alone only works in the browser that asked for the reset,
      which passes every local test and fails the phone-then-laptop case.
- [x] `lib/safe-redirect.ts` — open-redirect guard on `next`, shared with
      `signInAction`. The link authenticates before it forwards, which is what
      makes an unchecked destination worth more than an ordinary phishing link.
- [x] Success signs out all other sessions (`scope: "others"`).
- [x] Auth surfaces share one `AuthShell`, and `PasswordRulesList` is now one
      component instead of a copy in each password form.
- [x] 18 new unit tests; `npm run verify` green at 355.

**Production fix, after testing on the live domain.** Reset links landed on `/`
instead of the reset form.

- [x] **Root cause: the link never reached the app.** Supabase honours a
      `redirect_to` only when it matches its **Redirect URLs** allow-list, and
      silently falls back to **Site URL** when it does not. Landing on `/` is
      that fallback, so the three origins — `NEXT_PUBLIC_APP_URL`, Redirect
      URLs, Site URL — had disagreed since the domain changed.
      [DEPLOYMENT.md §4.0](DEPLOYMENT.md#40-url-configuration--get-this-wrong-and-every-emailed-link-goes-to-) now spells all three out with a symptom table.
- [x] `authRedirectOrigin()` replaces `pickAppUrl` for the emailed link. The
      share-link rule promotes the request origin when the env var is stale,
      which here produces a `redirect_to` that is *not* on the allow-list —
      one way to reach exactly this bug — and builds a password-reset link out
      of a request header, which is the classic reset-poisoning shape.
- [x] `/auth/confirm` writes the session onto the `NextResponse` it returns
      instead of mutating the ambient cookie store and throwing. The old form
      staked a single-use token on the framework flushing a mutated store onto
      a thrown redirect.
- [x] `route.test.ts` — 8 tests over the callback, including that the session
      cookies are on the 307 itself and that a rejected link carries none.
- [x] 13 more tests; `npm run verify` green at 368.

> Two Supabase dashboard settings are load-bearing and both fail silently:
> the recovery template must use `{{ .TokenHash }}`, and custom SMTP must be
> configured or resets are throttled to a handful an hour project-wide. See
> [DEPLOYMENT.md](DEPLOYMENT.md#4-supabase-auth).

#### Palette reconciliation ✅

`/` was rebuilt monochrome in Phase 7 and the app was left teal, so signing up
walked a visitor out of one product and into another. Resolved in one pass, as
the note promised, rather than drifting further.

- [x] **Teal removed from the codebase.** The production CSS bundle contains
      the string zero times. `/login`, all of `/dashboard/*` and `/master`.
- [x] **Three grey ramps became one.** 819 `neutral-*` uses (dashboard, booking,
      shared UI) and 83 `slate-*` uses (`/master`) swept to `zinc`, which is
      what `/` already used. A card on the dashboard and a card on the landing
      page are now the same colour rather than nearly the same colour.
- [x] Primary actions are solid ink and invert wholesale in dark mode —
      **contrast is the accent** when there is no accent hue. Measured on
      `/login`: 19.06:1 both schemes, 19.9:1 secondary link, 10.44:1 field label.
- [x] `--brand-gradient` reserved for *active* or *recommended*: the current nav
      item, the current setup step, the recommended tier, the upgrade path, the
      wordmark stop. White on its three stops measures 7.10 / 6.29 / 6.70.
- [x] `btnAccent` added **separate from** `btnPrimary`, so a save button can
      never become a gradient. That is how an accent turns into a theme.
- [x] Six hand-rolled buttons and inputs pulled onto the shared tokens instead
      of being recoloured in place — a recolour would have left the same copies
      to drift again.
- [x] `StatusChip` keeps amber / rose / emerald: those are **semantic**, read
      without a legend, and greying them would delete information. Only
      `confirmed` moved, teal → indigo, the gradient's mid stop.
- [x] Per-business `--accent` on `/[slug]` deliberately untouched. Verified in
      a browser that the demo tenant still renders its own cyan.

> The brand ramp is the *platform's* identity and `--accent` is the *tenant's*.
> Conflating them would have repainted every customer's booking page as a side
> effect of a marketing decision.

### Phase 9 — Product depth ✅

Everything between the palette reconciliation and the current head. Ordered as
it shipped; each bullet is one commit.

#### Multi-staff (0013–0018) ✅

- [x] `staff` and `staff_schedules`, `businesses.has_multiple_staff`, and
      `appointments.staff_id` NOT NULL with `ON DELETE RESTRICT` — history
      outlives the person. Backfilled one staff row per existing tenant.
- [x] **The exclusion constraint rekeyed on `(business_id, staff_id)`**, added
      while the old one still stood and dropped only afterwards, so the table
      is never unguarded for an instant. Its predicate is *inverted* — it lists
      the statuses that release a slot — which is what let 0014 add two enum
      values without naming them in a constraint.
- [x] `computeStaffSlots()` layers over `computeSlots()` rather than replacing
      it: every hard-won rule applies per person unchanged, and "a booking for
      A leaves the time open for B" falls out with no new logic.
- [x] Booking flow asks **the time first and the person second**, so step 2
      shows every time anyone can do. A single-staff tenant skips it silently;
      a team shop never does, even when only one person is free.
- [x] Per-staff time off (0016) via a **composite FK** on
      `(business_id, staff_id)`, so one tenant's closure cannot name another's
      staff. Phone, colour and portrait in 0017–0018.

#### Media uploads ✅

- [x] Browser → Supabase Storage directly, on a signed URL minted server-side
      after `requireWritable()`. The bytes never pass through Next: a Server
      Action body is capped at 1MB, and the browser has no Supabase session to
      authenticate with because the auth cookies are `httpOnly` by design.
- [x] Signed with the **service-role key** rather than the owner's session, so
      authorisation stays in one place. An RLS policy matching the path prefix
      against `auth.uid()` would be a second copy of "who owns this tenant" —
      and would silently break admin impersonation.
- [x] `admin-isolation.test.ts` resolves every import in `src/` and fails the
      build if a `"use client"` module reaches the admin client.
- [x] Video on the hero (mp4/webm, 25MB) with `autoPlay muted loop playsInline`.
      Bucket created by `npm run storage:setup`, **not** a migration — Storage
      lives in a schema PGlite does not have.

#### Availability fix ✅

- [x] **`staff_schedules` used to replace `working_hours`, not intersect it.**
      A provider whose row read 08:00–20:00 was offered 08:00–20:00 against a
      shop open 09:00–17:00, and a row on a closed weekday produced a fully
      bookable day out of nothing. `intersectShifts()` clips.
- [x] The inherit-or-intersect decision is made on the **raw row count**, so an
      empty intersection stays empty rather than being read as "no rows" and
      handing that person the whole day.
- [x] Cross-service blocking audited and found already correct — availability
      partitions by `staff_id` and never reads `service_id`. It lacked a test,
      which is what made it worth auditing.

#### "תורים באישור" (0019) ✅

- [x] A booking arrives as `pending` and **holds its slot** — non-terminal, so
      the exclusion constraint blocks it. A request that reserved nothing would
      be a request to be disappointed.
- [x] Three notification kinds rather than one status-aware template: by
      dispatch time a rejected request and a cancelled booking are both simply
      `cancelled`, so nothing in the row could tell them apart.
- [x] The confirmation screen changes wholesale — amber and an hourglass, no
      calendar download. Someone who skims a green tick has been told they have
      an appointment, and turns up.
- [x] Requests render **above** the agenda, because the agenda shows one day and
      a request can be for any day.

#### Client self-service ✅

- [x] `/[slug]/my-appointments` — phone lookup, upcoming and past, cancellation
      reusing `cancelBookingAction` with the token the lookup returns.
- [x] **A phone number is not a credential**, and the docs say so. Mitigated
      with the tightest non-auth rate limit in the app, tenant-scoped results
      proved by test, and `noindex`. The upgrade path is an OTP once SMS exists.

#### Dashboard depth ✅

- [x] One unsaved-changes bar replacing five per-section save buttons.
- [x] `/dashboard/analytics` — wall-clock heatmap (`AT TIME ZONE`, DST-proved),
      services, staff load, status split, trend. No charting library.
- [x] `/dashboard/agenda/full` — week grid where a custom block is a `time_off`
      row, so it blocks client bookings with no new blocking logic.
- [x] Mobile navigation: every dashboard page reachable from a phone, with
      `nav-coverage.test.ts` failing the build if one is not.

#### Tier line moved ✅

- [x] **Custom branding moved from Pro to Basic.** The cheapest paying tenant
      should not have a booking page in somebody else's colours.
- [x] Pro is now the three things that cost per tenant: analytics, message
      delivery, human setup time.
- [x] The analytics paywall ships **invented sample numbers**, not the tenant's
      figures behind a blur — a blur is a visual effect, not an access control.
      The page gates before it queries, asserted by test.

#### Messaging ✅

- [x] `WhatsAppService` over two backends. Green API preferred because the
      official Business API needs a Meta-approved template for a message the
      shop sends first, and Green API drives the shop's own account.
- [x] Reminders planned from the **lead time**: ≥30h ahead → 24h before,
      otherwise 2h before. The brief left 24–30h undefined; ordered thresholds
      matched longest-first close it, because a gap here sends nothing silently.

#### PWA + push (0020) ✅

- [x] Manifest opening on `/dashboard` — whoever installs this is an owner.
- [x] **A service worker that caches nothing.** For a booking app stale is
      worse than offline: an owner who sees a cached slot books over it.
- [x] One subscription row per **device**; the tenant flag is separate so
      toggling notifications never re-triggers a permission prompt that can
      only be refused once.
- [x] Push is deliberately **not** in the outbox — it is a nudge whose value
      expires in a minute, and the booking is on the dashboard either way.
- [x] `push_subscriptions` with RLS and an owner policy. The RLS test caught the
      omission before review did.

#### Marketing ✅

- [x] Proof strip, six interactive feature cards, and an install guide split
      iOS/Android — the two platforms genuinely differ, and on iOS Safari will
      not offer notification permission until the app is on the home screen.

> **`npm run verify` is green at 644 tests across 50 files**, up from 337 at
> the start of this phase.

### The E2E suite, and the soft 404 it was hiding ✅

The two long-standing red specs are fixed, and fixing the second one turned out
to be a product defect rather than a test defect.

- [x] **The stale slot selector.** `getByRole("radiogroup", { name: "בחירת שעה" })`
      named something that existed only in `e2e/`: the picker was rewritten to
      group slots into morning/afternoon/evening, each radiogroup labelled by
      its own heading — and those headings carry a count, so none of them has a
      stable name. The rendered slot list is now a `group` with that label,
      which the day strip has always had and the time area never did. It is
      rendered **only when there are slots**, so the helper's wait still means
      "the fetch finished with something to show" rather than settling on the
      skeleton.
- [x] **A third breakage, which the first was masking.** Once the flow got past
      the slot step it failed on the confirmation screen: the helper read the
      first `<dl>`, and the date and time had moved out of that list into the
      hero block above it — and swapped order, time first. Now matched
      independently rather than as one ordered pattern, because order is
      presentation and the helper wants two values.
- [x] **An unknown slug returns a real 404.** Resolved in `proxy.ts` before the
      response streams, which is Next's own documented remedy. Three-way path
      classification so a path that *cannot* be a slug costs no query; a
      bounded cache with separate maps for hits and misses; fails open on a
      database error. Full reasoning in
      [ARCHITECTURE.md](ARCHITECTURE.md#unknown-slugs-return-a-real-404).
- [x] `public-slug.coverage.test.ts` fails the build when a new top-level route
      is not declared, because `/[slug]` is a root segment and `src/app/pricing`
      would otherwise be 404'd by the proxy in production only.
- [x] 62 new unit tests; `npm run verify` green at **706 across 54 files**.
      Playwright green at 7 passed / 3 skipped — the dashboard specs need
      credentials for the account that actually owns `demo-barber`.

> **The docs had the SEO framing wrong and it is corrected in place.** The soft
> 404 was described as "what gets an empty page indexed", but `generateMetadata`
> already returns `noindex` for a missing slug and Next's guidance is that the
> meta tag is what prevents indexation while streaming. The real cost was that
> analytics could not tell a dead link from a live page, and every bot probe of
> the domain got a 200.

### Single-staff shops book only their primary provider ✅

Reported as "the slot grid jumps by five minutes". The step was never the
problem — it is `duration + buffer`, tested since Phase 1. `has_multiple_staff`
was documented as a UI switch, so availability read the **whole** roster even
for a shop that had answered "no", and a shop can legitimately hold other active
rows because collapsing back to one chair does not delete people with history.

- [x] `getAvailableSlotsWithStaff` evaluates only the primary provider when the
      flag is off. Applied above the engine — `computeStaffSlots` still just
      unions the list it is handed, so no tenant setting reaches the cursor walk.
- [x] `primaryStaff()` is the single definition of who that is, shared with
      `getDefaultStaff`, so availability and manual booking cannot disagree
      about who takes a booking.
- [x] **Two bugs, one cause.** A secondary provider's hours also widened the
      public page, and `createBookingAction` takes `freeStaff[0]` — so a booking
      could be assigned to someone the owner had stopped counting.
- [x] `/[slug]` filters the roster it ships to the browser by the same rule.
- [x] A team shop is untouched: its interleaved grid is real availability, and
      snapping it to a common grid would hide bookable times. Asserted in both
      directions from one fixture.
- [x] Two existing tests were exercising the incoherent state (two active staff,
      flag off) and now declare `team: true`, which is what they meant.
- [x] `npm run verify` green at **711 tests across 54 files**.

### Web push requires a real VAPID subject ✅

- [x] The hard-coded `mailto:` fallback is gone. The `sub` claim is how a push
      service reaches *the operator* (RFC 8292 §2.1), the domain in a constant
      need not belong to whoever deployed the code, and defaulting it made a
      missing variable invisible — the first symptom would have been a push
      service dropping traffic with `check:env` green.
- [x] Validated as `mailto:` / `https:`, with the `.env.example` placeholder
      **rejected by name**: it is structurally a valid `mailto:`, so nothing
      else would catch it.
- [x] One validator, shared by `check:env` and the runtime. Two copies would let
      a green deploy check coexist with a runtime that refuses; a test asserts
      they agree.
- [x] Half-configured push is an error in every mode, like email — `push:keys`
      prints all three lines at once, so two-of-three is a bad paste.
- [x] `check:env` reports `push → live` / `push → off`, because from inside the
      product a half-configured trio looks identical to an unconfigured one.
- [x] 22 new unit tests; `npm run verify` green at **733 across 55 files**.

### iOS safe areas actually apply now ✅

- [x] **Root cause: `viewport-fit=cover` was missing.** Five components already
      had `pb-[env(safe-area-inset-bottom)]` and every one was a no-op — iOS
      reports zero insets unless the viewport opts in, so the padding was real
      CSS computing to nothing.
- [x] The status bar is claimed back on `body`, scoped to
      `display-mode: standalone` — the topmost dashboard element is not fixed
      (banners can precede the nav), and padding it in a browser tab would push
      the landing hero down for nothing.
- [x] The bottom bar insets itself with its background still reaching the edge,
      floored at `0.25rem`; `main` clears `6rem + inset`.
- [x] `pwa.test.ts` asserts the viewport flag, because deleting it silently
      re-breaks all five.
- [x] `npm run verify` green at **737 across 55 files**.

> Compiled CSS, the meta tag and the absence of horizontal overflow are
> verified. The insets are zero in every browser available here, so the
> on-device result still wants a look on a real iPhone with the app installed.

### Client win-back automation (0021) ✅

The only marketing message the product sends, and it is built as one rather
than as another notification kind. סעיף 30א לחוק התקשורת treats "we have not
seen you in a while" as דבר פרסומת: prior explicit consent, an identifiable
sender, a working opt-out.

- [x] **Four gates, none of them sufficient alone**: the plan
      (`clientRetention`, Pro), the owner (`retention_enabled`, default false
      and never flipped by an upgrade), the client (a consent checkbox that is
      unticked and rendered only when the campaign is on), and the suppression
      list.
- [x] Consent lives on `appointments` and the **latest** booking wins, so
      leaving the box unticked next time withdraws it with no form and no
      support ticket. Never backfilled to true.
- [x] `checkInactiveClients` ships as `runRetentionSweep`, riding the daily
      cron beside the billing sweep and before dispatch, so a message queued
      this morning goes out this morning. Wrapped so a marketing failure can
      never stop a booking confirmation.
- [x] **Dedupe key is the lapsed appointment**, so a client who never returns
      gets exactly one message ever. A time-bucketed key would re-send on a
      schedule, which is what everyone means by spam. Capped at 25 per tenant
      per run, because the first run after switching on is otherwise a bulk
      send from the tenant's own number.
- [x] WhatsApp only, with **no console fallback** — the usual fallback would
      leave an owner believing a campaign is running while nothing is sent.
- [x] Re-checked at dispatch: rebooked clients and later opt-outs are skipped.
- [x] `marketing_opt_outs` makes the opt-out line a promise rather than a
      sentence. Scoped per business — consent is given to a shop, not to the
      platform.
- [x] The RLS test caught the new table before review did, again.
- [x] Landing page gains a seventh feature card, and its copy names the consent
      and the opt-out — the owner's first question is whether this makes them
      look like a spammer to their own customers.
- [x] 21 new unit tests; `npm run verify` green at **758 across 56 files**.

> **Migration `0021` has not been applied to any database.** It is additive —
> two defaulted columns, one table, one enum value — but it is not automatic on
> deploy. `npm run db:migrate`.

> **Still open: nothing reads inbound WhatsApp.** A client replying "הסר" is
> currently acted on by the owner rather than automatically;
> `addMarketingOptOut` is the call a webhook would make.

### Proof strip rebuilt as a glass card ✅

- [x] A `rounded-3xl` card inset on the page with a blurred halo of its own
      colour behind it, instead of a full-bleed band whose seam against the
      hero read as a second section starting.
- [x] **Dark glass, not white.** `bg-black/20` with a bright hairline, because
      a white scrim on a mid-toned mesh washes it out *and* costs contrast: it
      would drop white text to 4.54:1 and the detail line to ~3.1:1.
- [x] **Fixed a live AA failure.** The old strip put `text-white/70` straight on
      the mesh at **3.55:1**. It is now 5.05:1, with white at 7.59:1, both
      measured at the mesh's lightest composite.
- [x] Verified in a browser: three tiles, 3-up on desktop and stacked on mobile,
      inset 20px at 375px with no horizontal overflow and no console errors.

### Availability rebuilt on free windows ✅

The cursor walk fused "where is there free time" with "where may a slot start",
so a scattered day could not be asserted on. Now two steps: interval subtraction
produces free windows, then a packing rule places candidates inside them.

- [x] `mergeIntervals` / `subtractIntervals` / `freeWindows` exported and tested
      on their own, so the hole between a 10:00 and a 12:00 booking is a value.
- [x] **Single-staff packs densely** from each window's own start — a gap that
      opens at 09:35 is offered at 09:35.
- [x] **Multi-staff snaps to a lattice** anchored on the day's local midnight,
      so providers whose free time starts at different minutes still line up.
      This **reverses** the earlier "leave a team's interleaved grid alone"
      call, at the user's direction; the density it costs buys a readable column.
- [x] `slot_interval_min` is the lattice and is load-bearing again — the
      "live-looking setting that changes nothing" ARCHITECTURE.md warned about.
      GCD is the fallback only, floored at 5m because `gcd(15,20,30,45)` is 5
      and would recreate the five-minute noise this engine exists to remove.
- [x] Variable service lengths, scattered mid-day gaps, two-sided buffers and
      aggregated multi-service durations all covered — 31 new pure tests plus
      three through the real query path.
- [x] `npm run verify` green at **792 across 57 files**.

> **The boundary test is `start + duration <= end`, not
> `start + duration + buffer <= end` as specified.** The buffer is folded into
> the blocked intervals instead, which is the same rule stated once. Adding it
> to the test as well would double-count it after a booking and invent it at
> closing time, deleting the last slot of every day.

> **Multi-service aggregation is engine-ready, not shipped.** `durationMin`
> accepts a total and a test proves the gap arithmetic, but `appointments` holds
> a single `service_id` and no UI selects add-ons.

### The Playwright suite is green end to end ✅

- [x] **10/10 for the first time**, dashboard specs included.
- [x] The helper now walks the **staff step** — `demo-barber` has two active
      providers, so its public flow is four steps and the helper knew three. It
      handles both the picker and the sole-provider card, since which appears
      depends on who is free at the chosen time.
- [x] Two long-standing latent test bugs fixed: the picker locator resolved to
      the reviews list rather than the staff list, and the upcoming-booking
      assertion matched only the **plural** wording — so it could only ever pass
      when the calendar held two or more upcoming appointments, and the suite
      creates exactly one.

> A `/b/[token]` failure during this pass turned out to be a **stale dev
> server**, not a defect: it 404'd valid tokens until restarted, while the same
> query returned the row out of process. Worth knowing before debugging the
> query next time.

### Calendar legibility, last-visit truth, hero contrast ✅

- [x] **Week calendar.** The hour row went 56px → 80px from a shared constant
      (the rail and the columns must agree or the week shears). Under 30 minutes
      a card is one row rather than two clipped half-lines; 30+ is two. Solid
      fills became translucent cards with a 4px accent bar — staff colour where
      a legend exists above the grid, status colour otherwise.
- [x] **Hover card** with client, phone, service, price, staff, status and
      call/WhatsApp links. Positioned `fixed` at the calendar root: the grid's
      `overflow-x-auto` clips both axes, and the cards' own `backdrop-blur`
      would re-trap a fixed descendant. Opens on focus too, and the native
      `title` stays as the pointer-free fallback.
- [x] **Last visit ignores cancellations, no-shows and the future.** It was
      `max(starts_at)` over everything. The column is now nullable — "טרם הגיע"
      — with `NULLS LAST`, because Postgres sorts nulls first under `DESC`.
      10 new tests. On the live demo tenant, all 16 clients showed a date before
      and none of them had ever been in.
- [x] **Hero banner.** `hero-particles.tsx` deleted along with the dot grid;
      `.hero-obsidian` replaces `.brand-mesh` there at **11.51:1** against white
      (was 5.51), and 9.15:1 through the glass wall.
- [x] `npm run verify` green at **802 across 58 files**; Playwright 10/10.

> **The hero had no glass wall to keep.** The brief asked to retain one; the
> wordmark sat directly on the mesh. One was added to match the intent, with the
> text content and the panel's dimensions unchanged.

### Calendar views, nav fixes, booking-page polish ✅

- [x] **Hero reverted.** The darker ramp and glass wall are gone; the panel is
      `.brand-mesh` with the dot grid and the Canvas bubble field, exactly as it
      was. `.obsidian-mesh` survived the round trip and moved to the proof strip.
- [x] **Proof strip has no pattern and a deep panel.** Dots removed; the glass
      flipped from dark to light with the base, measured at **9.15:1** for white
      and **6.00:1** for `white/75` — better than the 7.59 / 5.05 it replaced.
- [x] **"יומן מלא"**, renamed from "לוח שבועי" and rendered in the brand
      gradient at a larger size — the one recommended action on the agenda,
      where it was previously indistinguishable from "share the link".
- [x] **יומי / שבועי toggle.** Same grid over a different column count, so
      there is no second implementation of lane assignment or placement. The
      view lives in the URL; `week` travels with it. The day view runs 112px an
      hour and draws **solid** cards — the opposite of the week rule, because
      one wide column has nothing to compete with.
- [x] **The "עוד" sheet no longer reopens itself.** Derived-from-pathname state
      resurrected on the way *back* to the route it was opened on. Now a boolean
      reset during render. **Verified end to end** in a browser at phone width.
- [x] **Gallery moved above the booking flow** and rebuilt as a snapping
      horizontal rail — it used to sit below the steps, where a first-time
      visitor reached it only after deciding.
- [x] **Footer CTA** on `/[slug]`: "רוצה עמוד כזה לעסק שלך? לחץ כאן" → `/`.
- [x] `npm run verify` green at **802 across 58 files**.

> **The brief located the gallery work at `/b/[token]`.** That route is the
> client's cancellation page and has never had a gallery; the description
> matches `/[slug]`, the public booking page, which is where both changes
> landed.

### Staff cleanup, notes badge, instant calendar ✅

- [x] **Single-staff mode deactivates the rest.** The toggle used to change only
      the flag, leaving the roster and a calendar column per person on screen
      while the concept was supposedly off. Reversible by design — nobody is
      deleted and no history moves.
- [x] **Delete staff**, gated on having no appointments. `ON DELETE RESTRICT` is
      the guarantee, not an obstacle: for anyone with history the action returns
      a sentence naming how many bookings they hold and points at deactivation.
      Two-step confirm, because it is the only control on that card that does
      not undo with the same click that made it.
- [x] **"ישנן הערות"** on agenda rows, pending requests and the calendar hover
      card — and **nothing at all** when a client left no note, which is what
      keeps the badge worth noticing. The note itself renders where there is
      room to read it.
- [x] **RTL arrows** swapped: back on the right, forward on the left. The
      chevrons pointed correctly but sat on the wrong sides.
- [x] **"חסימה חדשה" → "אירוע חדש".**
- [x] **Instant day/week transitions.** The server now always sends the week, so
      the toggle and steps within it are state changes rather than round trips
      — **measured at zero requests** across a toggle, a step and a return.
      Crossing a week boundary still navigates, via a real `<Link>` whose click
      handler cancels only when memory can serve it. Bounds, rows and lane
      assignment memoised; lane assignment is O(n²) per day and was re-running
      for all seven columns on every hover.
- [x] `npm run verify` green at **802 across 58 files**.

### `/master/alerts` reproduced and fixed ✅

The reported "Error 2407341431" was a **`RangeError: Invalid time value`** — an
error digest and a blank page, not an auth problem.

- [x] **Root cause: the driver returns an untyped aggregate as a string.** A
      bare `sql` fragment has no column type, so postgres.js hands back
      `"2026-08-04 12:44:56.938+00"` while the annotation claims `Date`.
      `Intl.DateTimeFormat.format()` coerces with `ToNumber` → `NaN` → throw.
      The truthiness guard in front of it passed, because a string is truthy.
      PGlite parses it into a `Date`, so no test could have caught it.
- [x] `queries/sql-types.ts` holds `toDate`, applied at every boundary that
      returns such an aggregate. **`.mapWith()` was tried first and does not
      work in that position** — the clients-directory tests caught it.
- [x] The page also formats defensively now: one unparseable value costs a dash
      in one row, not the console an operator opens *because* something is wrong.

> **Surfaced by the fix:** the alerts page shows **7 failed sends**, all Resend
> 403 "You can only send testing emails to your own email address". Client mail
> is not being delivered in production — a domain needs verifying at Resend.

### Phone-keyed client profile (0022) ✅

- [x] `client_profiles`, keyed on `(business_id, client_phone)` — the identity
      the rest of the product already uses. Keying on the name would merge two
      people called דני and split one who typed their name two ways.
- [x] Per business, never per platform; asserted by a test.
- [x] Upsert on the unique key, so two open tabs cannot race into a constraint
      violation.
- [x] A drawer on `/dashboard/clients`: visits / cancellations / no-shows,
      a "העדפות והערות" field, and the full booking history with statuses.
      History and stats load **on demand**; the list carries only a marker.
- [x] The calendar hover card shows the saved preferences, labelled and tinted
      apart from the booking's own note — one is a request for today, the other
      is what the shop knows about the person.
- [x] 13 new query tests; `npm run verify` green at **815 across 59 files**.

> **Migration `0022` is applied** — verified against the live database.

### The driver gap is enforced, not remembered ✅

- [x] `db/queries/sql-types.coverage.test.ts` — the same mechanical-coverage
      pattern as `nav-coverage` and `dashboard-session.coverage`, aimed at the
      one bug class this suite structurally *cannot* catch, because PGlite
      parses what postgres.js hands back as a string.
- [x] Two rules over every keyed `sql<…>` selection in `src/`: an annotation of
      `Date` must pass through `toDate` in the same file, and an annotation of
      `number` must carry a cast the driver decodes as one.
- [x] The second rule had **no prose anywhere before now**: `count(*)` is
      `int8`, which postgres.js returns as a *string* rather than lose precision
      past 2^53 — so an uncast count annotated `number` yields `"51"`, and
      `+ 1` yields `"511"`. Every count in the repo was already `::int`; that is
      now a rule rather than a habit. `int8` and `numeric` are deliberately
      absent from the accepted-cast list, because casting to either fixes
      nothing.
- [x] Verified the way the other coverage tests were — by breaking two real call
      sites (`toDate` on `listClients`, `::int` on the analytics weekday bucket)
      and confirming it named both, then restoring them.
- [x] Every current call site was already correct, so this is regression
      insurance rather than a fix. That is the point: the next one would have
      passed every test here and failed only in production.

### Booking page: an elevation system, and a stability rule ✅

A visual-only pass over `/[slug]` — CSS, typography, spacing, shadows and
micro-motion. No state, hooks, actions, props or data flow were touched, and
every accessible name, role and string is unchanged, which is what let the
Playwright suite stay the check on it.

- [x] **Four shadow tokens in `@theme inline`**, so they compose through
      `--tw-shadow` instead of being clobbered by a focus ring. `--shadow-accent`
      resolves the *tenant's* colour at the element — verified in-browser as
      `oklab(0.511 0.032 -0.260)` on the demo shop rather than the token default.
- [x] **A typographic scale where there was one size**: 32px business name,
      17px section headings, 15px body and controls.
- [x] **`text-zinc-400` was failing AA at 2.6:1** on real text in five places —
      stepper labels, slot period counts, review dates, the footer and every
      input placeholder. All at `zinc-500` (4.6:1) now. A scripted pass over
      every rendered text node returns zero failures in light *and* dark.
- [x] **Geometry never animates on a click target.** Hover lifts plus
      `transition-all` took the E2E suite red on `element is not stable`:
      Playwright hovers before it clicks, so the pointer starts a 200ms
      transition and the click lands mid-flight — the same window a real tap
      lands in on a device that fires hover first. Hover now deepens the shadow
      and moves nothing, press snaps untransitioned, and the one lift left is
      the selected day chip's, applied instantly as a state.
- [x] The footer platform CTA is a designed panel rather than a 12px underlined
      link, following the decision that `/[slug]` is **genuinely dual-purpose**.
      It stays monochrome and stays last, so it cannot compete with the shop's
      own call to action.
- [x] `npm run verify` green at **819 across 60 files**; Playwright **11/11**.

> **Screenshots were not available for this pass** — the Browser pane was not
> displayed, so nothing could composite frames. Verification was done against
> the DOM and computed styles instead, which is the stricter path for contrast
> and token resolution, plus the full Playwright run for the interactive flow.
> The rendered composition still wants a human eye.

### "ליבי" — the voice assistant ✅

**Rebuilt on OpenAI, and there is now exactly one of her.** The original was
browser speech recognition plus Claude, extracting a booking draft the owner
confirmed. It is gone — `libi-button.tsx`, `voice-actions.ts`, `libi.ts` and
`libi-schema.ts` with it — and the name moved to the implementation that
replaced it, so the app no longer has two assistants doing overlapping work.

- **`OPENAI_API_KEY` is the only model key this product uses.** The Anthropic
  entry was removed from `env.ts` with the code that read it. One key, one
  provider, one bill.
- **Pro-gated, and that gate is load-bearing.** `canAccessLibi && isVoiceConfigured()`
  in `dashboard/layout.tsx`. The move into the layout briefly dropped the
  entitlement half and handed a Pro feature to every Starter tenant; restoring
  it is why `libiEntitled()` exists there.
- **Reads run; destructive writes are asked about first, and booking is the
  exception.** See the bullet under *Shipped* below.

### Manual tier changes from `/master` ✅

- [x] `updateTenantPlanAction` beside the trial extension: a select between
      בסיסי and מקצועי, guarded by `requireSuperAdmin()` re-run inside the
      action, audited under `master.tenant.plan` with the admin's own id.
- [x] **Writes `plan_type`, never `subscription_status`.** A support control
      that could mark a tenant `active` would be inventing revenue — the thing
      the console billing provider refuses to do in production.
- [x] **`free` is unassignable.** It is the degraded state a non-paying status
      produces, not a tier anyone is put on; offering it would manufacture a
      state indistinguishable from a lapsed subscription. The enum derives from
      `ASSIGNABLE_PLANS`, so a third tier needs no second list.
- [x] **The table now shows the served tier beside the stored one.** Changing a
      *trialing* tenant's plan is invisible by design — a trial already grants
      `TRIAL_PLAN` — and without saying so the control reads as broken.
- [x] `planLabel()` derives Hebrew names from `PRICING_TIERS`, so the console
      and the pricing page cannot name the same tier differently.
- [x] 10 new tests against real Postgres, including the CHECK constraint
      rejecting a tier pushed past the type, and a trialing tenant's
      entitlements being identical before and after.
- [x] `npm run verify` green at **849 across 63 files**.

### Entitlement names, and the three Meta templates ✅

- [x] **Starter owns the whole design surface** — branding, landing content and
      calendar management are ungated above Starter, and a test now asserts it
      from the shape of the type rather than one key, so a future
      `customLandingPage: false` for Starter fails rather than ships.
- [x] **Starter blocked from WhatsApp, analytics and Libi**, which is what it
      already was. **No tenant's access changed in this pass.**
- [x] `whatsappReminders` → `canSendWhatsapp`, `advancedAnalytics` →
      `canAccessAnalytics`, `voiceAssistant` → `canAccessLibi`. The first is a
      real correction: it is the flag `clientDelivery()` reads, so it has always
      gated the confirmation, approval, rejection and cancellation too.
- [x] **The three approved templates** (`appointment_confirmation`,
      `reminder_24h`, `reminder_2h`) in `whatsapp-templates.ts`, with five
      positional parameters shared across all three — Meta freezes `{{n}}`
      numbering at approval, so the order is pinned by test.
- [x] **A blank field becomes `—`, never `""`** — the Cloud API rejects an empty
      body parameter, so a shop with no address would have every templated
      message fail rather than arrive without a location.
- [x] **Which reminder template is derived, not stored.** `leadHoursFor` recomputes
      it from `starts_at` and `scheduled_for`, so no migration and no second
      source of truth.
- [x] **No template is a real answer.** Kinds Meta never approved, and any lead
      that is not 24h or 2h, return null — deliberately not a nearest match, since
      rounding 36h onto `reminder_24h` would say *tomorrow* a day and a half early.
      Twilio then refuses rather than posting free text Meta drops silently.
- [x] 21 new tests; `npm run verify` green at **870 across 64 files**.

> ⚠️ **The reminder boundary moved from 30h to 24h, reintroducing what the 30h
> floor prevented.** A booking made 25 hours ahead is now reminded **one hour
> after it was made**. It moved because the approved copy is `reminder_24h` /
> `reminder_2h` and the spec ties the boundary to it. The fix, if it bites, is a
> minimum gap between booking and reminder — not moving the boundary back, which
> would strand 24–30h bookings on a template whose text no longer matches. A test
> pins the one-hour gap so it stays a known trade.

> **Unproven on a wire.** No template has been sent. Twilio addresses them by
> Content SID (`TWILIO_TEMPLATE_*`), and this environment has no Twilio account
> — the mapping, the parameter order and the refusal path are tested; the
> Meta round trip is not.

### `/master` tenant status, fixed ✅

Three symptoms, one cause: the console answered "what is this tenant served"
from `plan_type` and `subscription_status` while ignoring the freeze flag, and
the trial extension moved a clock nothing else read.

- [x] **A freeze now outranks everything.** `effectivePlan` returns `free` when
      `is_active` is false, ahead of the trial and the paid tier — a frozen
      tenant used to resolve to `pro` while the status pill beside it said
      frozen. There is **no `frozen_at` column**: a freeze is `is_active = false`
      plus `frozen_reason` of `admin` or `billing`.
- [x] **Extending a trial writes the status, not just the clock.** Pushing
      `trial_ends_at` forward on a lapsed tenant left them `past_due` with a
      grace clock running, so the console went on saying "מושהה" and nothing an
      admin could see had changed. It now sets `trialing`, clears
      `grace_started_at`, and lifts a **billing** freeze — all in one statement,
      for the reason the sweep states.
- [x] **An admin freeze is never lifted as a side effect.** Only
      `frozen_reason = 'billing'` comes back on a trial extension; an admin
      freeze is a deliberate act and `setTenantActiveAction` is where it is
      undone.
- [x] **`setTenantActive` moves `frozen_reason` with the flag.** It previously
      left the old reason behind, so a hand-unfrozen tenant still looked
      billing-frozen to `canAutoUnfreeze` — meaning a later admin freeze could
      be lifted automatically by a payment.
- [x] **The plan cell says *why*.** "מושהה" has three causes with three
      different fixes; the reason is printed beside it, which is what stops
      "I unfroze them and it still says מושהה" — unfreezing a `past_due` tenant
      genuinely leaves them served nothing.
- [x] 14 new tests against real Postgres, verified by reverting each fix and
      confirming the suite named it. `npm run verify` green at **880 across 64
      files**.

> **The consequence worth knowing:** analytics is the one *read* gated on an
> entitlement, so a frozen tenant now loses it. The calendar, client list and
> history are ungated and stay readable — which is what "reads stay open" has
> always meant in practice.

> **Caught by the suite, not by review:** ordering. `retentionBlockedReason`
> checked the entitlement before the freeze, so a frozen tenant started
> reporting "not entitled" — true, but it sends somebody to look at a plan that
> is fine. Frozen is checked first now.

> **The brief asked for `basic`; the column stores `starter`.** "Basic" is the
> display name — `0012` pinned the CHECK to `free|starter|pro`. Implemented as
> `starter` and labelled בסיסי.

#### 8d — The payment provider *(needs the provider decision)*

- [ ] Concrete `BillingProvider` (Stripe, or Cardcom/Meshulam/Grow for native
      חשבונית מס). `getBillingProvider()` is the only function to change.
- [ ] `POST /api/billing/webhook` — signature-verified; the provider signature
      is the auth, not a bearer token. Idempotent on `provider_event_id`, and
      calling the existing `activateSubscription()` rather than a second path.
- [ ] `payment_failed` → `past_due` + grace clock, reusing the sweep's states.
- [ ] Flip `check:env` to fail on a `console` billing provider in production.

#### 8e — Cost model

- [ ] `lib/cost-model.ts`, pure like `platform-metrics.ts`.
- [ ] Per-tenant usage query in `db/queries/admin.ts` (notification counts by
      channel, appointment volume).
- [ ] `/master` finance tab: **marginal** per-tenant cost reported separately
      from **fixed** platform overhead amortised across active tenants, plus
      break-even tenant count. A blended per-tenant number would be a confident
      fiction, and this is a screen a pricing decision gets made on.

---

### A Spanish showcase of the barbershop page ✅

`/demo-barber-es` is the demo barbershop's client page, in Spanish, for showing
the product to a Spanish-speaking prospect. Same business row, same calendar,
same photographs, same accent — only the rendering differs.

- **An alias, not a second business** (`lib/showcase.ts`). A second
  `businesses` row was the obvious approach and it would have broken the
  dashboard: `getBusinessByOwner` selects `.limit(1)` with **no ordering**, so a
  second row under one account makes *which shop the owner sees* a question
  Postgres answers differently on different days. `resolveSlug` maps the alias
  onto the real slug, and **both** `getActiveBusinessBySlug` and
  `activeBusinessSlugExists` call it — the proxy asks the cheap one before the
  page renders, so an alias known to one and not the other is a 404 on a page
  that would have worked.
- **The map is closed, deliberately.** Treating any `-es` suffix as a showcase
  would silently capture a real shop that registered that slug and serve their
  clients a translation of somebody else's page. Adding an alias is an edit.
- **Every lookup carries its own fallback**, and that is the whole safety
  design (`lib/booking-copy.ts`). A component asks for
  `t("service.title", "בחרו שירות")`, and the second argument — the literal that
  was already on the page — is what renders for Hebrew, for a missing key, for a
  typo, for a locale nobody added. **This cannot blank a string on the live
  page.** It is a flat map rather than a typed schema for the same reason: a
  schema would turn every missing key into a build failure, which is the wrong
  trade for a file whose job is to degrade quietly.
- **The shop's own words are a narrow, separate exception.** `showcaseContent`
  rewrites the *demo* tenant's service names and descriptions for display only,
  keyed on the exact Hebrew string, never touching the database. A service the
  owner renames stops matching and shows through in Hebrew — visibly wrong on
  the demo page, harmless everywhere else. Rewriting a real shop's words would
  be the software putting language in their mouth.
- **Context for the client tree, a prop for the server tree.** `useCopy()` /
  `useLocale()` / `useShowcaseContent()` cover the booking flow, which is five
  components deep with dialogs hanging off it. `BusinessReviews` and
  `page.tsx` take a `locale` prop instead — a server component has no context to
  read, and shipping a client bundle to translate two headings would undo the
  reason they render on the server.
- **The alias is `noindex`.** It is the same shop at a second address, and
  letting a crawler index both puts two pages for one barbershop in the results.
- **What is translated:** the booking page end to end (stepper, services, day
  and time, details form, confirmation, hours drawer, gallery, reviews,
  waitlist dialog), `/demo-barber-es/my-appointments` including its Server
  Action's error strings, the cookie banner and the consent line. Verified in a
  real browser at 430×940: **zero Hebrew text nodes** across landing, hours,
  no-slots, waitlist, times, details; the Hebrew page is unchanged at 32–48.
- **What is not:** `/b/[token]` (manage/cancel) and `/w/[token]` (waitlist
  invite) are addressed by an opaque token with no slug, so nothing in the URL
  says which language the visitor arrived in. Both stay Hebrew. They are
  reachable only *after* a real booking, which this page is not for.
  `[slug]/loading.tsx` renders "טוען…" for the moment before the page arrives;
  App Router gives loading UI no params, so it has no locale to read.

- **The prices are converted, not relabelled.** The showcase used to print the
  shop's real ILS prices to a reader being sold the product in dollars.
  Relabelling them would have been worse than leaving them: "$70" for a ₪70
  haircut overstates it by roughly 3.7×, and this page has a working book button
  under it. `showcasePrice` / `formatShowcasePrice` (`lib/booking-copy.ts`) map
  the demo's five prices to USD — ₪70/60/30/90/140 → $19/16/8/24/38, converted
  at ≈0.27 USD/ILS in September 2026 and then **rounded to a price a shop would
  actually post**, because an exact conversion gives $18.90 and no barbershop
  has ever charged that.
  **A table rather than a stored rate**, because a rate is right on the day it
  is written and quietly wrong forever after, with nothing on the page to say
  so. **Keyed on the service name *and* the amount, and the amount is the
  guard**: matching the name alone would keep printing $19 after the owner
  reprices to ₪75 — a stale number nobody can see is stale. With the amount in
  the key a reprice simply misses and the page falls back to ILS, which is
  visibly odd on the demo and correct everywhere else. It also fails in step
  with `showcaseContent`, since a renamed service drops out of both at once.
  **Not keyed on the price alone**, which was the first idea: ₪70 is one of the
  most common prices in Israel, and a future alias pointed at a real shop would
  silently re-denominate their whole menu.
  **Display only, like every other showcase rewrite** — the row still stores
  `priceCents: 7000, currency: 'ILS'`, so the owner's dashboard and their
  revenue figures are untouched by anyone reading the Spanish page.
  **The fifth call site is the one worth recording.** Four of them formatted a
  price the same way and a fifth, in `my-appointments.tsx`, passed a hard-coded
  `"ILS"` — so the lookup and the formatting are now a single function, because
  five call sites each free to render a price their own way is how the fifth one
  got missed the first time.
  Verified in a browser on the running server: the Spanish page carries **zero
  ILS symbols** and the Hebrew page **zero dollar signs**, both counted in the
  rendered HTML rather than eyeballed. The details step reads **"19 $ · 30 min"**
  — the same line that the RTL-mark trap below once turned into "30 · ₪70 min".
  `es-ES` prints USD as "19 $", symbol last, which is correct Spanish and is
  what the rest of the page's formatting already assumes.
  **Three of the five sites were seen, and two were not.** The service list and
  the details step were driven in a browser; the **confirmation screen** and
  **`/my-appointments`** both render a price only *after* a real booking
  exists, and writing one puts a row in the live `demo-barber` diary. They are
  covered by `showcase.test.ts` and are the same one-line call as the three
  that were seen — which is an argument, not a screenshot. Worth doing on the
  next run that writes a booking anyway.

**Two formatting traps, both found by looking rather than reasoning:**

- `Intl.NumberFormat("he-IL")` wraps an ILS price in **RIGHT-TO-LEFT MARKs** —
  `‏70 ‏₪`. Correct and invisible inside the Hebrew page.
  Inside the showcase's `ltr` column those marks flip the run they sit in, and
  "₪70 · 30 min" rendered as **"30 · ₪70 min"** — the duration torn apart around
  the price. `currencyDisplay: "narrowSymbol"` drops them and leaves the Hebrew
  byte-identical, which `showcase.test.ts` pins.
- **Hebrew glues its prefixes.** "מסכימים ל" + a link is one word with no gap,
  so the markup puts no space before the link — and Spanish then rendered
  "aceptas nuestra**Política de privacidad**". The space lives in the Spanish
  string itself, because JSX strips whitespace from literal text children but
  preserves it inside an expression's value. Any Spanish string that ends a
  clause before a link has a **deliberate trailing space**.

`showcase.test.ts` scans every `t("key", …)` call site in `src/` and fails if a
key has no Spanish string, if a Spanish value still contains Hebrew, or if one
is accidentally empty. That check exists because this feature was built by
hunting leftover Hebrew in screenshots, which is not a method that survives the
next change.

### Liquid glass: the appointment sheet and the calendar ✅

**One material for the calendar's floating surfaces**, in `globals.css` under
*LIQUID GLASS*: `.glass-sheet`, `.glass-float`, `.glass-control`,
`.glass-control-hue`, `.glass-inset`, `.glass-scrim`, `.glass-header`,
`.glass-frame`. Two decisions were Itay's, asked once before building: the
sheet's actions are **two wide pills (העברה, עריכה) and three bubbles (חיוג,
וואטסאפ, ביטול התור)**, and the glass **carries the colour of the card that
opened it** — the shop's accent, the provider's hue on a team, amber for a
request.

- **Glass as a specific effect, not a finish.** The sheet frosts the calendar
  it opens over, so the tapped booking stays faintly in view behind its own
  details; the pinned day row frosts the hours scrolling beneath it. The grid's
  frame, with nothing behind it, stays paper and only gains a lit edge and a
  shadow — blur there would be decoration.
- **Actions before details, because they are why the sheet opened.** Move and
  edit are 48px pills; call, WhatsApp (SMS where the number cannot reach
  WhatsApp) and cancel are 56px bubbles, the destructive one furthest from the
  thumb. A request's approve/reject pair goes above them, and approving is the
  only solid fill — emerald-700, because white on emerald-600 is 3.7:1 and the
  old quick action had been shipping it. Completed / no-show moved below the
  facts as quiet chips: they close the record. The label rows became a line of
  icon facts with screen-reader names. Every behaviour is unchanged — tabs,
  undo on cancel, the edit and move forms, focus on the close button, Escape.
- **"Move carries the booking's colour" is tinted glass under dark text**,
  never a fill under white: a provider can be amber-500, which cannot hold
  white text at AA, and this has to work for every hue a card can be.
- **Light and depth go through Tailwind's shadow variables.** These rules are
  unlayered, and an unlayered `box-shadow` beats `focus-visible:ring-2`, which
  draws the focus ring through `--tw-ring-shadow` — so every glass rule writes
  Tailwind's five-variable composition and sets `--tw-shadow` /
  `--tw-inset-shadow` inside it. Pinned in `calendar-layout.test.ts`.
- **Focus arrives at once.** The first browser pass found no ring on the first
  Tab stop; the computed `--tw-ring-shadow` was set, and the ring was mid-way
  through the controls' 200ms `box-shadow` transition. `:focus-visible` now
  has `transition-duration: 0s` — hover still eases, a keyboard user does not
  wait to find out where they are.
- **The cards changed nothing the contrast suite measures.** Tints and bases
  are byte-identical; the cards gained a lit top edge, a soft shadow in their
  own hue, and a hover that brightens the edge and deepens the glow without
  moving — a lift would spend the 2px `CARD_GAP_PX`. `.cal-pending` lost its
  `border-width: 2px` (which broke `CARD_BORDER_PX`; the padding absorbed it,
  measured at 1px, so nothing clipped) for an inset ring of the same weight, and
  a guard now fails any card rule that sizes a card.
- **Legibility is measured on painted pixels**, not reasoned: text colour
  resolved through a canvas, background taken as the commonest pixel in the
  element's own box on a screenshot over the real calendar. The sheet at
  1440px and 390px in both themes: **6.25:1 or better**. The hover card:
  **12.8:1**. The frosted header's weekday labels with cards scrolled beneath:
  **7.30:1 light, 5.98:1 dark** — the lowest reading anywhere. Toolbar labels
  moved to zinc-600 (zinc-500 measured 4.44:1 on the old track). The frost is
  **12px — `backdrop-blur-md`, the value the brief named** — and
  `prefers-reduced-transparency` or a browser without `backdrop-filter` gets
  solid surfaces.
- **ליבי's microphone sat on top of every dashboard modal on a phone.** Found by
  the first look at the sheet at 390px — the unseen view this plan had been
  listing. The microphone and her reply card were `z-50`, the same as every
  sheet, and an equal z-index falls back to DOM order, where she renders last.
  Both are `z-[46]` now: above her own listening ring (45), beneath modals and
  toasts (50). **Hit-tested at her position with each one open**: the
  appointment sheet, the phone's «עוד» sheet and «אירוע חדש» all sit above her
  now, and she is back when they close. The client drawer, the waitlist
  dialog and the block dialog share the same `fixed inset-0 z-50` wrapper, so
  they are fixed by the same construction — not individually opened.
- **One authored moment:** the page frosts over while the sheet rises into it —
  from the bottom edge on a phone, settling from just below on a desktop.
  Opacity and transform only on the sheet: a `filter` there would make it its
  own backdrop root, and its frost would blur nothing while it arrived.

### Pricing: allowances, overage, and ליבי in the trial ✅

**Basic ₪80 with 100 WhatsApp messages a month, ₪15 per 100 after; Pro ₪120
with 350, ₪10 per 100 after, and ליבי.** Yearly stays ten months for twelve
(₪800 / ₪1,200). The trial is still 14 days on `TRIAL_PLAN = "pro"`.

- **Basic could not send the messages it advertised.** Its copy said "עד 50
  הודעות וואטסאפ בחודש" while `starter.canSendWhatsapp` was `false` — a paying
  Basic tenant was promised WhatsApp and sent none. It is `true` now, which
  was checked against production before it shipped: the only tenants are the
  two demos (`trialing`, already served Pro) and `lacut` (frozen, served
  `free`), so **no tenant's messages changed on deploy**. A test now requires
  every plan that can send to have an allowance, and vice versa.
- **A cap became an allowance, and the name followed.** `whatsappMonthlyCap` →
  `whatsappIncluded`, beside `whatsappOverage: { per, cents }`. Exceeding it
  is priced, not blocked — the message past it is some client's confirmation,
  and dropping it would punish the client for the shop's plan. The allowance
  is **monitored, not enforced**, which is now a decision rather than a gap.
- **Overage counts every started block** (`whatsappOverageCents`): 101 messages
  on Basic is one ₪15 block. The spec said "for every additional 100" and did
  not say which; per started block is the reading under which the quoted rate
  is the price paid. **Nothing collects it** — no provider (8d) — so
  `/master/businesses` shows each tenant's month as `used / included +₪accrued`,
  amber once there is anything accrued, which makes the number checkable today.
- **The trial's promise is derived, not typed.** "כולל ליבי" appears on the
  pricing section, under both trial buttons, in onboarding, on the billing page
  and in a new FAQ — each gated on `trialEntitlements().canAccessLibi`, so
  moving `TRIAL_PLAN` to a tier without her removes the sentence instead of
  leaving it lying. `entitlements.test.ts` pins that the trial includes her.
- **Two FAQ answers had become false** and were rewritten from the tiers rather
  than retyped: reminders went "Basic by email, Pro by SMS" (both now send
  WhatsApp), and "a busy month won't cause an extra charge" (overage is exactly
  that). Bookings are still unlimited and the answer says so first.
- **ליבי is drawn apart on the Pro card** (`exclusiveFeature`, with the mic mark
  her bookings carry on the calendar), and `headlineFeatures` puts her first
  in onboarding's three-line picker, which would otherwise have shown a Pro
  card without the reason to pick it.
- **The pricing toggle now opens on monthly.** It opened on yearly, which made
  a visitor's first sight of these prices ₪66.67 and ₪100 — arithmetic before a
  reason to sign up. One line in `pricing-table.tsx` if that is reverted.
- **The terms' price line** is derived from the tiers and now carries the
  allowance and the overage; `lastUpdated` moved to 2026-09-14 because the
  prices in it changed.

**Worth knowing before these prices meet a real shop.** At the planning volume
in [WHATSAPP_TEMPLATES.md](WHATSAPP_TEMPLATES.md) §5 — 915 to 1,370 client
messages a month for a 17.5-bookings-a-day shop — the monthly bill computed by
`whatsappOverageCents` is **₪215–275 on Basic and ₪180–230 on Pro**, and **Pro
costs less than Basic from 301 messages a month**. The headline price is what a
very quiet shop pays. That is a pricing decision, not a code one, and nothing
here changes it.

**Three things left as they were, on purpose.** Pro still lists SMS, which
still has no Twilio account (see *Blocked*). `plans.ts` says prices include VAT
while the terms say they do not unless stated — a contradiction that predates
this change and belongs to whoever reviews the legal text. And **the month
`/master` counts is a UTC month**: `whatsappThisMonth` is `sent_at >=
date_trunc('month', now())` and the database session is UTC (checked), so the
counter turns over at 03:00 Israel time in summer and 02:00 in winter, and a
message sent in those hours on the 1st counts toward the month before. Harmless
for monitoring; fix it to the shop's timezone before anyone bills from it.

### The calendar at capacity: a load-test batch in `demo-barber` ✅

**`npm run db:seed:load-test` books a demo shop solid for this week and next,
and `npm run db:purge:load-test` takes exactly that batch out again** — a
preview until `-- --confirm` is added. The planner is `db/load-test-plan.ts`;
the runner and the purge are `db/seed-load-test.ts`. Run against production on
2026-09-15.

- **What went in: 148 rows, Sun 13.9 11:25 → Fri 25.9 13:45** — 126 confirmed,
  13 pending, 9 cancelled, 132 distinct clients, 17 with a note, created via
  online 66 / manual 73 / voice 9. Every open stretch is filled until no service
  fits: consecutive bookings sit 0 (36 pairs), 5 (86) or 10 (29) minutes apart,
  the only wider gaps are the 13:00–14:00 break, and Saturdays stay closed.
  Sunday and Monday already held the full-week seed's rows and gained two each.
- **Rows, not bookings — the opposite of `db:seed:full-week`, for the opposite
  question.** That one books through the real actions because it tests
  availability. This tests the calendar at a density the booking engine would
  never produce, so it writes rows — and writing a row queues nothing:
  confirmations, reminders and waitlist offers are put in the outbox by the
  actions, and the cron only sends what the outbox holds. **Read back after the
  run: 0 outbox rows for the batch, and 0 created anywhere in the 30 minutes
  before the read-back.**
- **The silence is checked, not assumed.** The runner refuses if
  `appointments` has a trigger (a Supabase database webhook is one), if a
  `pg_cron` job reads the table, or if WhatsApp dispatch is live — that last
  because *approving* a pending row by hand does queue a real message. No email
  is stored and marketing consent is false, so the channel walk and the
  win-back sweep have nothing to reach.
- **`0560` is the batch's own block.** `056` is every seed's prefix, but
  `seed-week` numbers start at `0561`, so the purge takes these 148 and not the
  99 older seeded rows. A second batch is refused while any `0560` row exists.
- **A diary, not a grid.** Names drawn within one community each — Hebrew,
  Arabic, Russian, Ethiopian-Israeli; parents booking children's cuts, sometimes
  two back to back; regulars back after six days or more. A booking flush
  against a neighbour is never `online`, because the booking page keeps the
  5-minute buffer, and so never `pending` either. Every cancellation sits under
  the booking that took its slot and was cancelled before that one was made.
  Seeded, so the dry run and the real run placed the same fortnight.
- **One thing this shop cannot show.** One chair, and the exclusion constraint
  forbids two live bookings on one provider — so **no overlapping lanes**; only
  a team makes them, and the planner fills each provider on its own for
  `--slug=demo-nails`. (The 13 pending rows drew as ordinary cards when this
  ran, because amber was gated on `requiresApproval`; *Liquid glass, round two*
  removed that gate, and they are amber now.)
- **Measured in a browser, both weeks:** 90 and 83 cards — the database's own
  live counts — in standard, compact and summary plus three day views, at 1440px
  and 390px. **0 intersecting cards, minimum clearance exactly 2.0px
  (`CARD_GAP_PX`), 0 squeezed or overflowing lines, 0 console errors.**
- **Mon 21.9 is Yom Kippur and is booked like any Monday.** The shop has no
  closure for it, and the planner follows posted hours and `time_off` exactly.
- **Tested from the rows, not from the planner's arithmetic.**
  `load-test-plan.test.ts` checks overlap, posted hours and "no bookable hole"
  over 25 seeds each. Eight deliberate breaks of the planner were each caught;
  the one that first survived — a cancelled row running past closing — was
  checked on a single seed, which is why that test now runs all 25.

### Liquid glass, round two: the dock, and a card that always says everything ✅

Three briefs from Itay, built together because they meet on the same screen:
the navigation as a connected glass dock, the calendar's cards in the same
material with every state distinct, and each density view promising a fixed
set of fields on **every** booking rather than on the ones tall enough.

- **The dock.** On a phone the bottom bar became one floating piece of glass
  (`.glass-dock`, `backdrop-blur-xl` as the brief named): four glass spheres
  and the overflow as a fifth, each a little taller than the band, so they read
  as drops joined by liquid rather than as buttons in a strip. The current tab
  is the one solid thing — lit glass with its name and the brand gradient
  glowing in its icon (`.glass-bubble-active`, `.glass-dock-glow`), the
  gradient still spent only on "active". Four spheres and one pill fit 390px
  where five labelled tabs truncated; every sphere keeps its name as
  `aria-label`/`title`. «עוד» moved from a header bar into the dock, so that bar
  is gone and the page gains its height. On a desktop the sidebar is the same
  glass as a floating rail, sticky, with each icon in its own bubble.
  `.dashboard-ambient` lays two sub-10% washes of the brand stops behind the
  dashboard so the glass has something real to frost. «היומן» now lights up on
  the full calendar too, which lit nothing before. Measured at 390px: dock
  331px wide, tabs 52px, 20px clear of ליבי's microphone, no horizontal
  overflow; toasts lifted above it.
- **The «עוד» sheet was dock-sized in the first browser pass** — see the new
  trap row: a `backdrop-filter` is a containing block for `fixed` children.
  It is portalled to `document.body` now; hit-tested above the microphone in
  both themes.
- **Cards.** Rounder, a white sheen along the top, an edge lifted towards white,
  a glow in the card's own hue, and a stronger tint — 20% in light (was 16),
  30% in dark (was 26), the collision ladder 28/36/44 and 34/39/44. **The dark
  sheen was measured out**: a 6% white sheen took the amber, emerald and sky
  staff hues under AA on every rung, so dark cards carry none and
  `calendar-glass-contrast.test.ts` models it at zero. The side accent bar is
  gone: it was hue alone carrying status. A team's card shows the legend's own
  dot, texture and all, before the name — and only on a team, keyed on
  `staffName`, because `staffColor` is set for a one-chair shop too.
- **Every state is its own thing, and none relies on hue.** A request is warm
  glass, amber gathering into orange, with a breathing hourglass mark. A
  finished booking carries a green tick; a no-show a crossed-out person; both
  are muted zinc glass with text at full zinc-600 strength (the old
  `opacity-55` put the secondary line under AA). A cancellation is muted,
  dashed, struck through and marked with a cross. Marks are white glyphs on the
  600 steps, each with a Hebrew name for a screen reader.
- **Requests are amber whether or not the shop runs "תורים באישור".** The gate
  on `requiresApproval` is gone: since 0029 a single service can require
  approval inside a shop that does not, and its requests had been drawn as
  ordinary bookings. The prop is removed from `WeekCalendar`.
- **Cancelled bookings are on the calendar again — while their slot is open.**
  The page now fetches them and `withoutCoveredCancellations` drops any whose
  time the same chair has since given to a live, finished or no-show booking,
  or a block (a whole-shop block for anybody). Drawn beside its replacement a
  cancellation split the column into lanes and halved every live card in that
  hour for a booking that is not happening.
- **The full view gives every booking its name, time and service.** The hour is
  no longer a class: `hourRowPx` grows it until the shortest appointment in the
  loaded week holds all three lines — 216px an hour in the week and 304 in the
  day view when a quarter hour is on screen, the base 96/160 otherwise — one
  scale for the whole week so the rail never shears, applied as a style to the
  rail and every column. Below ten minutes (`FULL_CONTENT_MIN_MINUTES`) the
  scale holds and the floor with its cap takes over. **What it costs:** a
  quarter-hour week is 2.25× as tall; the compact and overview views exist for
  scanning.
- **Compact shows a first name and a start time on every booking** — the hour
  grows to fit those two lines (144px for a quarter hour) and the card shows the
  first name only, because a surname in a 42px column is an ellipsis. Status is
  a coloured point in the corner, still named.
- **The overview fits the whole day on one screen and shows only start
  times**, as a small glass badge (`.cal-time-pill`), with a tick added for a
  finished booking. `.cal-summary-row` divides the frame's own `68dvh`/`76dvh`
  (less the now fixed `h-12` day header) by `--cal-rows`, and the overview
  drops the empty padding hour either side, so demo-barber's day is ten rows.
  The old fixed `h-12` hour scrolled 47px on a phone. Because only the
  stylesheet knows that hour, the overview's floor is a percentage of the grid
  (`blockMinHeight`) rather than pixels.
- **The day agenda is the same glass** — rows as `.glass-row` with a request
  edged in amber, the time in a set-in capsule, every action a glass pill, and
  approving the one solid control (emerald-700).
- **Measured in a browser**, desktop 1440 and phone 390, light and dark, on the
  load-test fortnight: 91 and 83 cards a week, **0 intersecting, 2.0px minimum
  clearance, 0 clipped lines, 0 cards missing a field** in every view; overview
  frame overflow **0**; every overview badge inside its card; 0 console errors.
  Completed and no-show were seen on two load-test rows set by SQL for the pass
  and put back to confirmed afterwards; a cancellation was seen on the week of
  6.9, where a seeded one still holds an open slot.
- **Tests:** the fuzz now draws every card on the grown hour and the overview at
  36, 48 and 72px an hour through the percentage floor — 0 touching pairs
  across 3000 days; `hourRowPx`, `blockMinHeight` and
  `withoutCoveredCancellations` are pinned; the contrast suite measures the
  request's two stops and the muted glass in both themes; the nav tests follow
  the sheet into the dock.

### Pausing online bookings (0035) ✅

**A switch that stops the public page taking bookings and leaves the owner's
calendar alone** — for the Friday on which next week's hours are rebuilt. The
design is in [ARCHITECTURE.md](ARCHITECTURE.md#pausing-online-bookings-0035);
the short version:

- **`businesses.bookings_paused`**, default false, applied to production on
  2026-09-16 after Itay approved it (ask → apply → verify → push): 36 migrations
  recorded, none pending, the column present on all three shops, all false.
- **Refused on every public path, before any work**: the slot lookup and the
  booking return `BOOKINGS_PAUSED`, the waitlist claim returns the person to the
  queue, and a cancellation's automatic offer goes to nobody. **The owner's
  manual booking, edit, move and ליבי never read it.** Five deliberate breaks of
  these guards were each caught by `bookings-pause.test.ts`, which also runs the
  offer against PGlite with the migration applied.
- **The switch reads "קבלת הזמנות אונליין" and pausing is turning it off** — the
  thing that is normally true is what is on. It sits at the top of the desktop
  rail, first in the phone's «עוד» sheet, and first on the settings page;
  instant, never behind the save bar. While it is off, every dashboard page
  opens with an amber card saying what clients see, with «חידוש ההזמנות» on it.
  The card lives in the content column: as a full-width strip it pushed the
  glass rail down and took «התנתקות» below the fold, found in the browser pass.
- **The page**: a frosted notice in the tenant's accent above the steps, with a
  call button where the shop has a phone; services stay browsable; the day strip
  is disabled and the times are one line. A page loaded before the pause
  switches into the same state on its first refusal. Spanish on the showcase.
- **Verified in a browser against production, demo-barber paused for 36
  seconds and then 17** (Itay approved a short pause): all 21 day chips
  disabled, **no server action called** after the paused page loaded, the
  Spanish notice on `/demo-barber-es`, settings and the phone sheet in step,
  resumed from the banner. Contrast measured on pixels: banner 13.4:1, notice
  title 15.6:1, body 9.2:1 light and 9.7:1 dark. The shop was confirmed open
  from the database afterwards.
- **Not exercised end to end:** a manual booking made while paused. It would
  write a real appointment and queue its messages; the owner paths are held by
  the guard test instead.

### ליבי in a loud shop: hearing, capture and the end of a turn ✅

An audit of the voice pipeline found the transcript failing for reasons that
had little to do with Hebrew: a legacy transcriber, client names that never
reached it, a microphone that clipped the first syllable, and a fixed loudness
threshold that any barbershop crossed. This round replaces all four. The map of
the pipeline as it now stands is in [ARCHITECTURE.md](ARCHITECTURE.md#ליבי--the-voice-assistant).

- **Measured before it was chosen.** 64 Hebrew clips — the configured
  ElevenLabs voice and an OpenAI voice, eight commands built from
  `demo-barber`'s real client names (ג'ורג' ג'בארין, ארטיום לבדב, ברהנו אדמסו…),
  clean, under synthetic clippers at 10dB and 3dB, and under music with a
  melody at 6dB — scored on the names, verbs and times the diary needs:

  | transcriber | recognised | median |
  | --- | --- | --- |
  | `whisper-1`, the production prompt | 149/224 | 1404ms |
  | `gpt-transcribe`, keywords + context | **208/224** | **735ms** |
  | `gpt-transcribe`, keywords only | 202/224 | 867ms |
  | `gpt-transcribe`, context only | 177/224 | 798ms |
  | `gpt-4o-mini-transcribe-2025-12-15`, names in the prompt | 157/224 | 655ms |

  The mini model repeated its prompt verbatim on three noisy clips and answered
  two in English, which is why a faster model is not the one used.
- **`gpt-transcribe` with `keywords[]` and `languages[]`**, both confirmed
  against the live API: repeated multipart fields, a JSON string for either is
  refused, ~1000 fields is refused ("Could not parse multipart form") and 500
  are not. Keywords are staff, services, five command verbs and up to 150
  upcoming clients from `upcomingClientNames` (the fortnight from the shop's
  midnight, nearest first, never the voice placeholder). The `prompt` is one
  sentence describing the conversation plus ליבי's last line — the pending
  question, where there is one. `whisper-1` is the fallback on a failed request
  only.
- **An empty transcript keeps the question.** It used to drop the pending
  action, so a repeated "כן" answered nothing; the route now hands it back and
  the browser listens again, at most twice in a row. `gpt-transcribe` returns
  empty for a word it cannot hear under clippers; `whisper-1` returned "תודה".
- **`correctHearing` lost two entries that were real words**: "קלי" is a given
  name and "קולה" is Hebrew, and both were being rewritten to "קולי". "תבדלי" →
  "תבטלי" was added, from a noisy clip. **`audio/x-m4a`** became
  `speech.x-m4a`, which the API refuses; `audioExtension` maps it.
- **One microphone per conversation**, opened with `echoCancellation`,
  `noiseSuppression`, `autoGainControl` and `channelCount: 1`, recorded as
  WebM/Opus at 32kbps where the browser can, and released when the
  conversation ends, the page is hidden, or the component unmounts.
- **The end of a turn is `libi-vad.ts`, rewritten.** Speech-band level from an
  FFT, the room as the median of recent buckets, a voice-shaped onset, and an
  end relative to the room or to the owner's own peak. Calibrated frame by
  frame on the same 16 commands with six more seconds of noise after each:
  the old detector ran **64 of 64** noisy turns to its twenty-second cap; the
  new one ends **46 of the 48** where the voice is at least 3dB above the noise
  within a second or two of the words, and 7 of 16 where music is as loud as
  the voice. Same results at 44.1kHz and 16kHz. A ratcheting room estimate
  (only learning from buckets under the sustain line) was found by the
  calibration, not in review, and is pinned by a test.
- **A held button overrules the detector**, and letting go keeps a 500ms tail.
  A pressed turn waits 8s for a voice and then sends; a re-opened turn waits
  4.5s and discards only when nothing at all happened. Caps are 15s and 10s,
  down from 20s.
- **Two older bugs fixed on the way.** Closing the card while ליבי spoke armed
  the discard flag with nothing recording, and the owner's *next* question was
  thrown away. And the stream kept writing to a request the owner had left,
  which surfaced as `voice.tts` errors — seen in the dev server's log during
  the browser run below, gone after the fix.
- **Verified in a real browser**, Chromium playing WAV files as the
  microphone against the dev server, production data, and the real
  transcription, intent and speech providers — read-only turns and one
  cancellation proposed and never confirmed:
  - a clean question transcribed exactly, the turn ended ~1.8s after the words,
    the answer spoken, the microphone re-opened by itself and closed 4.4s later
    with nothing heard; one `getUserMedia` for the whole conversation, its
    track `ended` afterwards;
  - clippers running to the end of a 12.7s file: the turn ended at 4.9s, and
    "תבטלי את התור של ג'ורג' ג'בארין" came back exactly;
  - music running to the end of an 11.9s file: ended at 4.4s, exact;
  - holding the button through the silence: stopped 131ms after release (the
    detector already knew); letting go mid-word: stopped 842ms after release,
    tail kept. The browser reported the constraints as applied and the
    recorder as `audio/webm;codecs=opus` at 32000.
- **What the run showed next:** asked to cancel ג'ורג' ג'בארין, the model
  answered "אני לא רואה תור" without calling the tool — his booking sat
  outside the 25 roster rows the prompt called complete. Fixed in the round
  below.
- **Not verified here:** an iPhone. Holding the microphone open across a
  conversation is what the brief asked for; whether iOS lowers playback volume
  while a capture is live needs a real device.

### ליבי, faster: tolerant names, an honest diary, a quicker voice ✅

The second half of the audit's list. The browser run at the end of the round
above had shown what came next: a cancellation answered with "אני לא רואה תור"
by a model that never called the tool.

- **Near names are found.** `libi-names.ts` compares a name the exact lookup
  missed against every upcoming client: vowel points, geresh and quotes
  stripped, final letters folded, vowel letters ignored, one or two letters of
  slack on tokens of four letters or more, exact only below that — "דנה" is
  not "דינה". Ties come back as a question naming both people ("מצאתי 2
  תורים: איתן אלקיים ב-10:00 ואיתן טולדנו ב-11:00. איזה מהם לבטל?"). Used by
  the find, cancel, move and show tools, and for services with unambiguous
  matches only; every match speaks the diary's own name, and the destructive
  tools still wait for "כן". The model is also told its input is a transcript
  and to pass the diary's spelling.
- **The diary is no longer called complete when it was not.** The prompt had
  the first 25 of a week's rows under "זו הרשימה המלאה — אין תורים אחרים"; on
  `demo-barber`'s load-tested week (81 live bookings) that was Thursday, Friday
  and four of Sunday's thirteen. Now: today and tomorrow in full (up to 40
  rows, with "מוצגים X מתוך Y" when cut), every other day as a count and its
  first and last time, a read cap of 300 and a line saying so if it is ever
  reached, and a rule that no client is declared absent without the tool.
  Verified in the browser: the same cancellation now proposes "מצאתי תור של
  ג'ורג' ג'בארין ביום חמישי ב-17:05. לבטל אותו?", and "מה יש לי ביום שני?"
  answers "17 תורים, הראשון ב-09:05 והאחרון ב-18:35" where it would have said
  nothing.
- **`eleven_v3_conversational` is the default voice**, measured warm on this
  account: 212ms to the first byte and 1033ms for a sentence, against
  `eleven_v3`'s 837ms and 2871ms. Read back through the transcriber both are
  intelligible Hebrew. MP3 at 22kHz/32kbps instead of 44kHz/128kbps — 19KB a
  sentence instead of 71KB, same latency. `eleven_multilingual_v2` and
  `eleven_turbo_v2_5` left the allowed list: ElevenLabs lists neither as
  speaking Hebrew, and this file had recommended turbo as the fix for a slow
  turn. The OpenAI fallback is `gpt-4o-mini-tts-2025-12-15` with Hebrew
  instructions — the only OpenAI voice of three that read all test sentences
  cleanly.
- **`speed: 1.1` never did anything.** Probed three times each at 0.8, 1.2 and
  unset on both v3 models, durations read from constant-bitrate files: all
  between 5.7s and 7.0s at random. The key is gone, and ליבי is sped up in the
  browser instead — decoded at 22kHz and time-stretched ×1.1 with WSOLA
  (`libi-stretch.ts`), pitch unchanged, ~20ms for a long sentence; stretched
  recordings still transcribe as before.
- **The first word comes sooner.** A long opening sentence is cut at its first
  comma, since a piece plays only when whole: first audio went from 1.43s to
  0.85s after the text line on the same question, the two pieces playing 13ms
  apart.
- **The owner can talk over her.** The button no longer disables while she
  speaks; a press stops the clip, drops the rest of that answer's stream, and
  opens the microphone — 138–147ms from press to listening, and the old answer
  never flips the new turn back to idle.
- **Shorter waits where it is safe.** The pause that ends a turn is 1.4s where
  the owner's peak stands 14dB over the room and 1.8s where it does not, and
  0.8s after a one-word answer to a question she just asked. Calibrated on the
  same 80 turns: 1.4s everywhere clipped three noisy commands the longer pause
  kept; the adaptive pause kept all of them and moved the median stop from
  1.51s to 1.22s after the last word.
- **The diary is read while the audio is heard**, and the transcriber's
  vocabulary is cached for 30 seconds per shop, so a conversation's later turns
  skip that round trip (605ms → 1ms measured). Every response now carries
  `Server-Timing`: `auth`, `upload`, `ctx`, `stt`, `roster`, `llm`, `tool`.
- **Measured end to end in Chromium** against production data from this
  machine: from the recorder stopping to the text line ~4.9s on a first turn
  (auth 0.9s, vocabulary 0.6s, transcription 1.0s, model 1.5s, tool 0.6s) and
  ~2.5s on a follow-up question; first audio ~0.85s after that. **The biggest
  fixed cost left is distance**: the functions run in `fra1` and the database
  is in Seoul, and every one of those round trips pays for it.
- **Changed locally, and needed in production:** `.env.local` pinned
  `ELEVENLABS_MODEL_ID=eleven_v3` and now reads `eleven_v3_conversational`.
  The Vercel variable, if it is set the same way, keeps the slow model until it
  is changed or deleted — see *Blocked on a decision or an account*.

### ליבי asks, swaps, and sees next week ✅

Five gaps in what she did once she had understood: the calendar behind her
card never changed, a move with no destination and a booking with no service
were filled in or answered generically, a swap had no tool at all, "next week"
fell off the end of her diary, and "את אלופה" came back as a word Hebrew does
not have. The map of the pipeline as it now stands is in
[ARCHITECTURE.md](ARCHITECTURE.md#ליבי--the-voice-assistant).

- **The calendar changes when she does.** Every write now reports a
  `DiaryChange` — `created`, `moved`, `cancelled` or `swapped`, with the ids —
  on the NDJSON text line, and the client calls `router.refresh()` when it sees
  one. The calendar is server-rendered and cannot see a write it did not make,
  and a route handler cannot refresh the client the way a server action does
  (Next 16's `refresh()` is Server-Action-only), so the browser has to. State
  survives the refresh: the conversation, the microphone and the clip in the
  air carry on. Nothing is revalidated server-side because there is nothing
  cached — the dashboard layout and the booking page are `force-dynamic`.
- **What a write owes afterwards is now the same on every path**
  (`lib/appointment-aftermath.ts`). The dashboard's buttons re-planned a moved
  appointment's reminder and told a cancelled client; ליבי's spoken "כן" made
  the same change and did neither — a moved booking kept a reminder timed for
  the hour it had left, and a cancelled client was never told. Her *tap* button
  already went through the dashboard actions, so the same card behaved
  differently for a finger and a word. Both actions and the voice path now call
  one module; the voice route runs it in `after()`, once the answer has been
  sent. **A spoken cancellation now notifies the client exactly as the
  dashboard's does**, and offers the freed slot to the waitlist. A voice
  placeholder has nobody to tell and queues nothing.
- **A missing detail is the tool's question, never its default.** "תזיזי את
  התור של X" with no destination finds the booking and asks "לאיזו שעה או
  לאיזה יום להזיז אותו?"; a booking with no hour asks for it; a shop selling
  more than one service is asked which (four options read out, "למשל" past
  that), and a team shop is asked "אצל מי?" — among the people *free for the
  whole service at that hour*, so the question has no wrong answers; one free
  person is booked and named, nobody free is said. Order follows dependency:
  hour, then service (it sets the length), then provider. A single-chair shop
  (`has_multiple_staff` off) is never asked who — the booking page's own rule.
  This reverses the §5 decision that defaulted to the shop's first service:
  a default is a booking at a length nobody chose.
- **The half-finished request rides back as a `DraftAction`**, beside the
  pending action and trusted no more. It is kept apart from `pending` on
  purpose: a pending action is complete and waits for a yes, a draft waits for
  a *detail*, and a yes means nothing to it. A bare answer — "זקן", "אצל
  שירן" — is matched against the shop's own list without a model call, the way
  "כן" is matched against a word list; anything else (every hour included)
  goes to the model with the draft stated in the prompt as data, day and all,
  so the call it makes is a copy rather than a reconstruction on a write that
  does not ask for confirmation. The card stays up while a draft waits.
- **The verb decides a move, whatever the model made of it.** Found in the
  browser: "תזיזי את התור של רפאל שטרן", transcribed perfectly, went to
  `find_client_appointments` and was read back instead of asked about. The
  prompt now says so plainly, and `routeByVerb` sends a lookup whose
  transcript carries a move verb to the move proposal — the one direction that
  cannot write, never for a frozen tenant.
- **"איזה מהם?" can finally be answered.** She read the times back when a name
  fitted several bookings, but the tools took a name and nothing else, so "של
  שתיים" resolved to the same bookings and she asked again, for ever. The
  proposals take the booking's current date and time as a hint, and the
  question names the days when the choices fall on different ones — two
  bookings at ten were read back as "ב-10:00 ו-10:00".
- **Swapping is one proposal and one transaction**
  (`propose_swap_appointments`, `lib/appointment-swap.ts`). Each client takes
  the other's slot — time and provider together, the calendar's two cards
  changing places, with the new provider *said* when it changes. The length
  stays with the appointment, so there are exactly two answers: **back to back
  on one provider** (a gap of up to 15 minutes, nothing between) they swap
  order inside the block they share, which fills it exactly with no overlap
  and no hole; **anywhere else** they exchange start times if that fits, and
  the refusal names whoever is in the way — "לתור של דנה כהן צריך שעה, וב-14:30
  כבר יש תור לעומר" — before anybody is asked to confirm. Confirmed by "כן" or
  by the card's button (`swapAppointmentsAction`), both through `confirmSwap`,
  which re-plans from the rows as they are now and refuses unless the plan
  lands where the question said.
- **The constraint forced the transaction's shape.**
  `appointments_no_overlap_staff` is not deferrable, so two moves fail halfway
  whenever the two share a provider. `swapAppointments` parks the first on an
  empty range (`ends_at = starts_at` — the empty `tstzrange` overlaps nothing),
  moves the second, then the first; every write is a compare-and-swap on the
  start it was planned against, and anything that fails rolls all three back.
  A test shows the naive sequence being refused before the swap succeeds.
- **Next week is in her diary.** The window ran seven days, so asked on a
  Thursday about next Tuesday she read a diary that stopped on Wednesday and a
  line calling absent days empty. It now runs to the Saturday that ends next
  week (`rosterDays`), the header names this week's and next week's dates, the
  "days not shown are empty" claim stops at the last day actually read, and
  the cap is 600. `get_week_summary` answers "מה יש לי בשבוע הבא?" from a
  query and `spokenWeek` — a count, the days, the busiest — rather than a model
  adding seven lines, and opens the calendar on that week when asked to show it.
- **"את אלופה" is expected, not forced into a word.** Said quickly, its two
  words run together, and a transcriber primed only for names and verbs wrote
  "תלופה". Courtesy phrases are keywords now (not a bare "תודה", the word the
  old model invented out of silence), the context sentence says she is
  sometimes thanked, `correctHearing` maps "תלופה" back, and the prompt answers
  thanks with "תודה!" and no tool.
- **Two tests had been passing by accident.** "עיצוב זקנים" never matched
  "עיצוב זקן" — the plural's נ is not the singular's final ן — and "עיצוב
  הזקן" never matched either; both fell back to the shop's first service,
  which happened to be the expected one. Asking instead of falling back
  exposed them. Services are now compared through `nameKey` with the definite
  article stripped from both sides.
- **Verified in a browser against production data**, the microphone replaced
  by a stream the test spoke generated Hebrew into, everything after it real.
  Read-only: "מה יש לי בשבוע הבא?" → "בשבוע הבא יש לך 83 תורים ב-6 ימים. הכי
  עמוס ביום שני, עם 17 תורים." (the database's own count); a move with no
  destination → the question and a draft; a booking with no service → "איזה
  שירות — למשל…"; a swap of two back-to-back bookings of 15 and 45 minutes →
  the re-ordered times; "מעולה, את אלופה" → transcribed exactly, answered
  "תודה!". **With the owner's approval, one conversation wrote:** two voice
  placeholders booked (on the calendar 2.5s and 2.8s after the text line, no
  reload), swapped by a spoken "כן, בבקשה", and cancelled the same way (each
  card changed ~2.7s after its line); no console errors, no notification and
  no waitlist invite created. The two rows were then deleted by id, so
  `demo-barber` is as it was. A synthetic 0.3-second "כן" was too short for
  the detector to count as speech; a natural "כן, בבקשה" was heard every time.
- **Not verified in a browser:** the team questions ("אצל מי?") — the E2E
  account owns the single-chair `demo-barber` only. Unit-tested.
- `npm run verify` green at **1841 across 112 files**.

### The calendar you can edit, and a dashboard that no longer waits ✅

Five requests from one review of the phone agenda, the week grid and ליבי:
the dock, editing the week by hand, cropping empty hours, a status and a glow
for ליבי, and the lag stepping between days and weeks. The maps are in
[ARCHITECTURE.md](ARCHITECTURE.md#weeks-and-days-are-held-in-memory-and-fetched-ahead).

- **The dock stops covering the page.** `main` reserves the dock's own height
  plus the safe area at the bottom, so the last card always scrolls clear of
  it; the dock itself is denser glass (`.glass-dock-float`: 40px blur, a
  `white/20` edge in dark, a two-layer `shadow-2xl`) written through the
  `--tw-shadow` composition so focus rings survive. **ליבי's button docks into
  the navigation's row on a phone** (a portal into `LIBI_DOCK_SLOT_ID`) instead
  of floating 5rem above the bottom over the dock's last bubble, and the active
  tab's label folds away under a 25.5rem container so the row still fits.
  Measured at 390 and 430px: the lowest content ends above the dock's top edge,
  no horizontal overflow.
- **Stepping days and weeks no longer navigates.** Both views hold the range on
  screen in their own state and read it from `lib/range-cache.ts` — from memory
  when it was seen or fetched ahead (the neighbours are prefetched 250ms after
  a range draws), from `/api/dashboard/day` or `/week` when it is new, drawn as
  its dates and hours with the cards to follow. The endpoints and the pages
  share one loader each (`loadAgendaDay`, `loadCalendarWeek`), so a refresh and
  a step cannot draw different ranges. A write, or any server render, marks
  every held range stale; a prefetch in flight across a write lands stale.
  Client notes are now read for the week's clients only. `EntryCard` is
  `memo`'d with every prop held stable, so a hover repaints no card.
  **Measured on a production build at 390px against the Seoul database**, where the baseline was a full navigation — 2.5–2.9s a day and 2.1–2.2s a week, the date and the bookings arriving together behind a skeleton: the date now changes in **2–14ms**, and the bookings follow in **0.004–0.55s** when the owner has read the range for a second and a half, **1.5–1.85s** at worst — a step tapped the instant the page loaded, before its neighbours had arrived — with no page skeleton either way.
- **Edit mode** (`lib/calendar-edit.ts`): a toolbar toggle, off by default.
  Drag a booking to another time or day — **five-minute snap**, the ghost red on
  the same provider's booking (refused: the constraint would refuse it anyway),
  amber on a block or closed hours (asked, then sent with `force`), the frame
  scrolling under a held drag. Drop is `rescheduleAppointmentAction`, shown at
  once through `useOptimistic`. The server asks more often than the ghost
  warns — the booking page's slots follow the free windows, so a five-minute
  mark is often not one a client would be offered — and the card then waits
  where it was dropped, ringed amber, for the owner's "לשבץ בכל זאת"; nothing
  else can be picked or dragged until the question is answered and a write
  in flight has landed. **Tap two to swap**: `previewSwapAction` plans it
  with `previewSwap` — ליבי's `planSwapFor`, the same answer for two lengths —
  the tray shows where each lands, and the tap sends the preview's own
  `SwapRequest` to `swapAppointmentsAction`, which refuses if the diary moved
  underneath. Keyboard: Enter lifts and drops, arrows carry, Space picks for a
  swap, a live region reads the landing. A test feeds a preview straight into
  `confirmSwap` to prove the two cannot disagree.
- **Crop empty hours** — a toggle beside the density, remembered per device.
  The grid runs from the first booking's hour to the last one's, falls back to
  the opening hours on an empty range, and is lifted while editing.
- **ליבי says where she is.** The voice route now opens its stream the moment
  the transcript exists: a `stage` line with what she heard, then `roster`,
  `llm`, `tool` as each step of `decide` finishes, then the text, a `timing`
  line and the audio. The client shows an orb (`thinking-orbs`) and the step
  actually running — שומעת → בודקת ביומן → חושבת → מטפלת בזה → מנסחת תשובה
  (`lib/voice/libi-status.ts`) — with what she heard beside it, a pill on the
  first turn and the card's row after. The empty-transcript refusal still comes
  before the stream, so every `libi-loop` pin held unchanged. `Server-Timing`
  now carries only what is known before the stream opens (to `stt`); the full
  breakdown is the `timing` line.
- **And a glow that answers the voice.** `voice-glow`'s `VoiceBeam` along the
  bottom of the screen replaced the CSS ring: it rises with the owner's voice
  (fed the silence detector's own level — no second audio graph), gathers into
  a travelling beam while she thinks, and follows a meter tapped off her
  playback while she answers. Both packages load only once she is used, and are
  preloaded three seconds after a page settles.
- **Found in the browser, not by the tests:**
  - The dock's "היומן" left the agenda on Saturday: a navigation back to the
    day the page first drew was served from the router's cache with the *same*
    props, so neither a date nor an identity comparison saw it. Navigations are
    now detected on the URL, which every in-memory step keeps in step.
  - The loading spinner's reserved square pushed the calendar's toolbar to
    three rows on a phone; it lives in the rail's empty corner now.
  - The glow rendered as nothing: its injected stylesheet makes its root
    `position: relative`, after Tailwind's, so a `fixed` class on it lost. It
    sits in a fixed frame of ours.
  - A drop the server questioned bounced: the card jumped home and left a
    ghost while the owner was asked. It now waits where it was dropped.
  - A pick made while a move was still saving planned the swap against the
    old positions — `confirmSwap` would have refused it as stale, so safe, but
    a question about the wrong times. Picks and drags now wait for the write.
  - A dev server with a stray lockfile a directory up (the root
    `package.json`/`package-lock.json`/`node_modules` from an `npm install` run
    at the repo root) picked the wrong workspace root and 500'd on every page;
    `turbopack.root` now pins it.
- **Verified in a browser against production data, read-only** (every Server
  Action POST aborted during the drags, only the swap preview let through):
  week steps drawn in 21–114ms, from memory when held; the crop 13 → 11 rows
  and back; 82 movable cards; a drag's ghost with a live time turning red
  "תפוס · עומר מזרחי" on a clash; Escape and the keyboard lift putting it back;
  a swap preview of two back-to-back 20-minute bookings reading 09:00 ↔ 09:25;
  zero console errors — at 1280 and 390px, light and dark. ליבי on one spoken
  "מה יש לי בשבוע הבא?": the stream's lines in order (`heard`, `roster`, `llm`,
  `tool`, text, timing, two clips), the pill walking שומעת → חושבת → מנסחת
  תשובה → מדברת, the glow rising, sweeping and following her voice.
  **With the owner's approval, one test wrote**, on a production build: two no-contact placeholders (`is_voice_placeholder`, empty phone) on Tue 29.9 at 10:00 and 11:00. A dragged to 12:00 was drawn there 8ms after release; the server answered 5.5s later with its question (12:00 is not a slot the booking page offers), the card waiting in place ringed amber meanwhile; confirmed, it held 12:00 in every sampled frame through the ~6s forced save. The swap preview read 11:00 ↔ 12:00, both cards moved 74ms after the tap and never jumped back, and a reload read the same from the server. Four actions, zero console errors, zero notifications queued. Both rows were then deleted by id, so `demo-barber` is as it was.
- `npm run verify` green at **1897 across 115 files**.

### Edits that never wait, a dock the page fades under, ליבי on the landing page ✅

Four requests in one: tidy the repo root and the dev terminal, make every
calendar edit instant, separate the dock from what scrolls under it, and put
ליבי and the current design on the landing page. The maps are in
[ARCHITECTURE.md](ARCHITECTURE.md#every-edit-is-drawn-before-it-is-sent) and
[there for the landing page](ARCHITECTURE.md#the-landing-pages-phones-are-drawn-not-photographed).

- **The repo root is clean, and the dev terminal quiet.** The stray
  `package.json`, `package-lock.json` and `node_modules/` at the root went to
  the Recycle Bin; `turbopack.root` stays as the guard.
  `logging.serverFunctions: false` — `next dev` no longer prints every Server
  Action's arguments, the sign-in password among them.
- **Every calendar edit is drawn before it is sent, and nothing waits on the
  answer.** `useOptimistic` gave way to a `pendingEdits` list drawn over the
  data: confirmed on the server's yes and settled during render once the data
  shows it; taken back — an error toast, the card shaking in its old place —
  only on an explicit refusal or a failed request, which also re-reads the
  week in case it saved after all.
  - **A drop is final.** The server's question and its round trip (5.5s last
    time, the card ringed amber meanwhile) are gone: the ghost already showed
    the owner the slot, so a move is sent with `force`, and the toast names a
    block or closed hours and carries undo. **The past is refused** in the
    browser (`nowInWeek`; the ghost reads "כבר עבר" in red), as a clash was.
  - **Swaps are planned in the browser.** `planSwap` moved to the pure
    `lib/swap-plan.ts`; `planCalendarSwap` runs it on the week on screen, with
    "booked between" answered from the same rows, so the tray is up at the
    second tap and `previewSwapAction` is gone. `confirmSwap` still re-plans on
    the server and refuses a stale plan. Six tests hold the browser's plan to
    `planSwapFor`'s over one PGlite week; three pin the past.
  - Picks and drags no longer wait for a write in flight — Next dispatches a
    client's actions one at a time, so they land in order. A spinner in the
    rail's corner says a save is pending.
  - **Found in the browser:** a rollback left the "done" toast and its undo on
    screen, and an undo pressed after a failed swap would have planned from
    the untouched week — and performed the swap. `toast()` now returns an id,
    the context has `dismiss`, and a rollback takes the "done" down with it.
- **The dock stands off the page.** `.glass-dock-float` is a 64px blur (from
  40) at saturation 1.9 over a 0.76 fill (0.74 dark). Under it, inside the
  phone's `<nav>`, `.dock-fade`: the page's own paper rising from transparent
  through a mask, with a 6px blur of its own, 3rem taller than the dock's row —
  so cards fade out before they reach the glass. `pointer-events: none`, and
  no blur under reduced transparency.
- **ליבי on the landing page.** The hero's lede now says the diary is run by
  voice, a fourth fact reads "עוזרת קולית ליומן", the first feature card is
  hers, and she has a section straight after the proof strip — "מדברים עם
  היומן": five things an owner says, what she does with each and which she
  asks about first, and one exchange played through, every line verbatim from
  `libi-tools` and `libi-status`, her orb and glow in CSS.
- **Every phone on the page is drawn.** The hero (the agenda, ליבי
  mid-question, the dock) and the tour's three (the week in edit mode with a
  card lifted and a swap picked; the amber requests panel; clients) are React
  built from the dashboard's own classes, scaled through Tailwind's variables.
  The 15 screenshots (3.2MB), `phone-frame`, `dashboard-mockup`,
  `lib/screenshots` and its test are deleted. **No static asset is required.**
- **Verified in a browser, read-only** — every Server Action POST held 1.5s,
  then aborted, so nothing reached the database:
  - The dock at 390px, light and dark, on the agenda and the week:
    `blur(64px) saturate(1.9)` computed, the fade 120px tall across the
    screen, no horizontal overflow.
  - The week at 1280px, **on a production build**: a booking dragged into
    Sunday — red, "כבר עבר", the refusal toast, zero requests. Next week: the
    swap tray **7ms** after the second tap, zero requests; confirmed, both
    cards swapped and the spinner up **33ms** after the tap, the "done" toast
    with its undo beside them; at the abort both returned and the error
    replaced the "done". A drop onto closed Saturday was drawn **18ms** after
    release with "מחוץ לשעות הפעילות", and rolled back the same way. (The grid
    narrowed while that card was away — its day was the week's only two-lane
    one, beside a cancelled booking — and widened back: lanes set the width.)
    No reload, and no console error but the two aborted requests.
  - The landing page at 1440 and 390px, light and dark: no horizontal
    overflow; the phones 352×750 in the hero and 304×646 in the tour.
- `npm run verify` green at **1898 across 114 files** (`screenshots.test.ts`
  went with the images).

### A calendar that fits the day, a delete for what was cancelled, and the sign-up that answered `{}` ✅

Four reports in one, opened with a screenshot of the sign-up form showing an
error message two characters long. The maps are in
[ARCHITECTURE.md](ARCHITECTURE.md#a-500-from-supabase-auth-arrives-as-),
[the hour](ARCHITECTURE.md#how-tall-an-hour-is-and-which-hours-are-drawn-at-all)
and [the delete](ARCHITECTURE.md#deleting-a-cancelled-booking).

- **Sign-up answered `{}`, and now it answers in Hebrew — but the cause is a
  setting, not code.** From auth-js 2.108 every 5xx is treated as a transport
  failure: the client builds its message with `JSON.stringify(response)`
  without reading the body, and a `Response` has no enumerable own properties,
  so both the form and the log got `{}` and the server's own sentence was
  never read. What the database says: **no row for that address in
  `auth.users`, no trigger on it, three users in total and the newest from
  18.8** — so the account was rolled back inside GoTrue, which is what a failed
  confirmation send does, and no sign-up has succeeded in a month.
  - The server client now installs a `fetch` that clones a 5xx from
    `/auth/v1/` and keeps its body; the action logs it (`serverStatus`,
    `serverPath`, `serverCode`, `serverSaid`) and tells the reader which
    failure it was — the mail one by name, because that is the one no account
    was created for and nothing they typed caused. `usableMessage` stops `{}`
    and `[object Object]` being treated as messages anywhere.
  - `signUp` now passes `emailRedirectTo` → `/auth/confirm?next=/dashboard`,
    and `/auth/confirm` defaults by link type instead of sending every link to
    the password-reset form. A link that cannot be exchanged (the mail opened
    on a second device, where the PKCE verifier does not exist) lands on
    `/login?error=confirm`, which says the address *is* confirmed and to sign
    in — true, because Supabase confirms before it redirects.
  - **What is still broken is the project's mail**: Supabase Auth sends its own
    mail, and this account's Resend domain is unverified — the same cause as
    "client email reaches nobody" in §5, reaching a second surface. Verify the
    domain (or point Supabase's SMTP somewhere that delivers) and sign-up works;
    until then it fails with a sentence that says so.
  - Pinned by `auth-failure.test.ts`, which holds a **real** client to a
    stand-in auth server: a 500 arrives as `{}`, the wrapper keeps "Error
    sending confirmation email", and the sign-up's `redirect_to` carries our
    own confirm route. Plus 13 tests on the readers themselves.
- **The calendar fits the day again.** The hour had been growing until the
  shortest booking could hold all three lines *stacked* — 216px for a
  quarter-hour beard trim, 324 for ten minutes. It now grows only as far as the
  **two-line** card, which carries the same three fields (the name, then
  `10:00–10:30 · תספורת`): **144px** with a quarter hour on screen, 96 without
  one. The day view sets all three side by side on its one wide line and is
  flat at **160** (was 304). `compact` is a fixed **72px** hour with a one-line
  chip — first name and start time — so a ten-hour day is 720px, one screen.
  The floors follow the same arithmetic (34 / 30 / 16), so a lone short booking
  is lifted to exactly the card its mode promises and no further.
- **Dead hours are cropped by default.** The toggle and the preference behind it
  are gone: every view now runs from the first booking's hour to the last one's,
  and edit mode expands to the working day and an hour either side, because an
  hour cropped away is an hour nothing can be dragged into.
- **A cancelled booking can be deleted.** Its sheet offers מחיקה — only there —
  behind "למחוק תור זה?", naming the client and the time, with the consequence
  on the button and no undo pretended afterwards. `deleteCancelledAppointment`
  scopes by tenant *and* status inside one `WHERE`, so a booking restored in
  another tab is simply not deleted and a live one cannot be removed by a
  crafted id; `notifications` cascade with it. Three query tests.
- **Found while verifying:** a card's time span rendered **mirrored** —
  `09:15–09:00`, the end time first — because two numeric runs either side of a
  dash reorder inside an RTL line. Every span the calendar draws now carries
  `dir="ltr"`, as the dialog's always had.
- **Verified in a browser, read-only** (every Server Action POST aborted, so
  nothing could write), at 1280 and 390px:
  - The hour measured **144** detailed and **72** compact, the grid 1440px and
    720px over the same ten hours; a quarter-hour card is 34px and reads
    `שי גולדשטיין` / `09:00–09:15 · עיצוב זקן`, and a compact one is 16px and
    reads `שי 09:00`. The day view: 160px an hour, a quarter hour 38px with all
    three fields on one line.
  - The crop: **09:00–18:00** on the week as drawn, **08:00–19:00** the moment
    edit mode opens.
  - The delete: the sheet on a cancelled booking offers החזרה לתור פעיל,
    עריכה and מחיקה; מחיקה opens "למחוק תור זה?" with the client, the time and
    the two buttons; backing out restores the sheet. **Nothing was deleted** —
    no Server Action left the browser in the whole run.
  - `/login?error=confirm` renders its sentence, and a magnified card shows the
    span reading start to end after the `dir` fix.
- `npm run verify` green at **1913 across 115 files**.

### WhatsApp per business, a quieter ליבי, and a calendar that says it is being edited ✅

Five requests: a WhatsApp switch per tenant in `/master`, ליבי's visuals in
the landing page's calmer language, a choice behind "אירוע חדש", an edit mode
nobody can miss, and the landing page's text and calendar mockup. The maps are
in ARCHITECTURE — *Three switches can stop WhatsApp*, *Edit mode says so on the
calendar itself*, *"אירוע חדש" is two things*, *What she shows while she
works*, and *The landing page's phones are drawn*.

- **WhatsApp, per business (0036).** `businesses.whatsapp_enabled`, default
  on, set from a switch in the WhatsApp column of `/master/businesses`. Off,
  WhatsApp leaves that tenant's channel walk — a confirmation or reminder
  falls through to SMS or email where there is one, a win-back is not queued —
  and anything already queued on it is skipped at dispatch with the reason. It
  joins the environment variable and the platform-wide toggle; any one says
  no. **A trigger refuses a change to the column from the tenant's own role**,
  because `businesses_owner_all` lets an owner write their own row through
  PostgREST. **Applied to production 2026-09-22 with the owner's approval**
  and read back: 37 migrations, the column `boolean NOT NULL DEFAULT true`, all
  5 businesses on, the trigger enabled.
- **ליבי, quieter.** The canvas orb (`thinking-orbs`) and the audio-reactive
  beam (`voice-glow`) are gone — uninstalled, with the level meter that fed the
  beam — replaced by the landing page's own: `.libi-orb`, a dotted ring whose
  tempo follows her state, and `.libi-glow`, a soft brand-coloured band that
  breathes and fades between phases. CSS only; nothing loads when she is used.
- **"אירוע חדש" is a menu**: חסימת זמן (the block dialog) or תור ידני (the
  agenda's manual-booking dialog, now reachable from the week — the page loads
  the active services for it). Keyboard as a menu button; closes on Escape or
  a press elsewhere.
- **Edit mode wears violet in four places**: a ring, halo and glow on the
  calendar's frame, a faint dot canvas over the columns, a banner ("מצב עריכה
  פעיל." with a live dot and סיום), and the filled toggle. The drag, the swap
  and the instant saves are untouched. Found on the way: **a narrow density's
  drag ghost** cut "12:05–12:35" to "12…" in a 42px lane; it now says the start
  time and a first name, at the chips' own size.
- **The landing page.** The ליבי section keeps its heading and paragraph
  beside the conversation; the sample-phrase list and the footnote under it are
  gone. **The calendar phone is rebuilt on the calendar's own layout
  functions** — the 72px compact hour, edit mode's full working day, lanes,
  boxes, floors and line budgets — with seven days (the crop button it still
  showed is gone), the new violet edit frame, one request in amber and one
  booking being carried. Its booking chip's span (`16:00–16:30`) and the
  showcase's are `dir="ltr"`.
- **Verified in a browser**: the edit frame (the ring and glow read back from
  computed styles, seven canvases, the banner) and the menu (both items, focus
  on open, arrows, Escape back to the button, each dialog opening) at 1280 and
  390, light and dark, **with every Server Action blocked**. ליבי through a
  whole turn with a stand-in microphone and **her endpoint answered in the
  page** — never reached: glow `recording` at 0.9 → `processing` at 0.55 with
  the orb going `listening` → `searching` → `working` → `speaking` at 0.8,
  `breathing` → faded out; no canvas on the page at any point. The landing page
  at 1440 and 390 in both schemes, no horizontal overflow, and the calendar
  phone magnified. **With the owner's approval**, demo-barber's WhatsApp was
  switched off in `/master`, read back after a reload, and switched on again.
- **Found, not fixed — needs its own change:** the same PostgREST path lets an
  owner write *every* column of their own `businesses` row, including
  `plan_type`, `subscription_status`, `trial_ends_at` and `is_active`. Only
  `whatsapp_enabled` is guarded. See §5.
- `npm run verify` green at **1919 across 115 files**.

---

## 5. Where things stand

_The handover between sessions. **If it disagrees with the code, the code is
right.** Read this, then open the file it points at — the reasoning lives in
comments beside the thing it explains, which is why this stays a map._

**Green:** `npm run verify` at **1919 tests across 115 files**; Playwright
**11/11** across 3 specs (not run every session). **All 37 migrations
(0000–0036) are applied to production** — 0036 (`whatsapp_enabled` and its
guard trigger) on 2026-09-22, read back from `drizzle.__drizzle_migrations`. 0031 is among them,
so the orphaned `siri_api_token` columns are gone; the "0031 is pending" this
line once carried was stale. Fifteen tables, RLS on
every one, zero reachable by `anon`. **No migration pending.**

> ⚠️ **The ordering rule 0025 established, for every migration after it.**
> Every `businesses` read is a bare `.select()`, which Drizzle compiles to an
> explicit column list from the schema — so code that knows about a column the
> database lacks fails `getActiveBusinessBySlug` and `getBusinessById`. That is
> the public booking page and the whole dashboard, not just the new feature.
> A push to `main` deploys. **Apply the migration before the push, never
> after.**

**Security:** [SECURITY_AUDIT.md](SECURITY_AUDIT.md) — full pre-launch review.
Two fixed (a live stored XSS in the booking page's JSON-LD; owner binding
accepting an unconfirmed address), sixteen passed, four needing a decision.

**Pilot readiness:** [WHATSAPP_TEMPLATES.md](WHATSAPP_TEMPLATES.md) holds the
copy for the six unsubmitted Meta templates and the message-volume formula;
[EDGE_CASES.md](EDGE_CASES.md) maps what the suite proves, what it cannot, and
the ranked residual risk.

**Live demo tenants:** `/demo-barber` (1 chair, approval off, owned by
`itaybarkay64@`) and `/demo-nails` (**2 active providers**, approval **on**,
owned by `xitaybarkay@`). Both are owned by real accounts — read the seed traps
below before running it.

> ⚠️ **The demo shops hold 273 appointments** — `demo-barber` 231, `demo-nails`
> 42 — counted against production on 2026-09-15. **148 of `demo-barber`'s are
> a load-test batch that books the shop solid from Sun 13.9 to Fri 25.9.**
> Until it is purged the public page offers nothing for those two weeks, and
> the E2E `bookAppointment` helper fails with "No bookable slot found in the
> next 10 days". `npm run db:purge:load-test` previews the purge; add
> `-- --confirm` to run it. See *The calendar at capacity* above.
>
> This block has now been stale in *both* directions: it claimed ~293 and ~124,
> was corrected to **zero** on 2026-08-29, and that zero then outlived the
> full-week seed run recorded below, which put 99 rows back. The numbers are
> the first thing a session trusts, so **count them rather than reading them**
> — a `select count(*)` grouped by slug takes a minute, and this line has been
> wrong more often than it has been right.
>
> **Three kinds of row, told apart by phone.** `0560…` is the load-test batch
> (148). Other `056…` numbers came from `db:seed:full-week` (99: 73 barber, 26
> nails). The remaining 26 are `db:seed:appointments` rows, ליבי's own
> placeholder bookings from the live voice checks, and one manual booking made
> and cancelled by hand. Outside the batch, by status: **114 confirmed, 1
> pending, 10 cancelled**. Two `demo-barber` rows outside it read
> `created_via = 'voice'`, flipped by hand — see the `created_via` note further
> down.
>
> Everything else is intact — services, staff, logos, galleries, reviews,
> waitlist rows — so both booking pages work and the E2E suite still books
> against `demo-barber`. The landing page's two demo buttons lead to shops with
> a full calendar, and the dashboard has something to screenshot.
>
> Worth keeping from when this said zero: nothing had cascaded those rows away,
> and that is the thing to know before hunting for a bug —
> `appointments.service_id` and `staff_id` are `onDelete: restrict`, so
> deleting a service or a provider is *refused* while appointments reference
> it. A demo calendar that empties was emptied deliberately. `npm run db:seed`
> rebuilds one; run `-- --dry-run` first, as always.
>
> **`npm run db:seed:full-week` fills a week by *booking* it**, through the same
> two actions a client uses — `fetchSlotsAction` for what is free and
> `createBookingAction` to take it. It computes no start times of its own, which
> is the entire point: a seeder that worked them out would agree with itself and
> could never catch a buffer that is not applied, a slot offered inside a break,
> or a duration that runs past closing. A week that fills is evidence about the
> availability engine; a week that stops early is a finding.
>
> **The loop lives in `/api/dev/seed-week` because it cannot live in a script.**
> Both actions call `getClientIp()`, which calls `headers()`, which throws
> outside a request scope — `tsx` gets "`headers` was called outside a request
> scope" and nothing else. The route runs the loop inside a real request; the
> npm script is a thin client that drives it a day at a time.
>
> **One request per day, learned the hard way.** Filling the whole week in one
> request held the response open for the entire run and died at undici's
> five-minute header timeout with 23 rows written and no report. Per-day
> requests finish, report as they go, and lose a day rather than everything.
>
> **A service that runs out for a day cannot come back**, because availability
> only shrinks as a day fills. Remembering that turned the loop from asking all
> five services on every iteration into one query per booking — the difference
> between a day finishing and a day timing out.
>
> **Three guards, and the first is that it does not exist.** No
> `SEED_ROUTE_ENABLED=true` and the route is a 404, not a 403: an endpoint that
> writes a hundred bookings should not announce itself to somebody probing for
> it. Then the same WhatsApp suppression check the old seeder used, then the
> demo-slug allowlist. The rate limiter is *cleared as it goes* rather than
> weakened — ten bookings an hour from one IP is correct for the public internet
> and fatal to a volume test, so the route deletes counters keyed to its own
> caller and leaves the rules alone.
>
> **`elapsedMs` is load-bearing.** Below `MIN_HUMAN_FILL_MS` the honeypot
> classifies the submission as a bot and returns a *fabricated* confirmation — a
> success with no row behind it. A seeder that sent `0` would report a full week
> and write nothing.
>
> **Run over both demos: 99 bookings, 178 outbox rows, nothing sent.** 70
> confirmed, 23 awaiting approval, 6 cancelled through the client's own link.
> Zero overlapping blocking pairs.
>
> **The rate limiter caught the harness, which is the best thing that happened.**
> The first full run booked *nothing* for one shop and exactly five a day for the
> other, with 32 refusals reading "try again in about 11 hours". `serial` started
> at zero inside the handler, so splitting to one request per day reset it every
> day and `0561000001` was reused fourteen times — `BOOKING_RULES.phoneDaily`
> refusing everything past the fifth. The per-phone rule is the one that
> distinguishes a person from a script, and it fired against a plausible-looking
> harness. Numbers now come from a random block per request; the phone rule is
> still deliberately left armed.
>
> **Every remaining hole is a cancellation, except one — and that one is the
> buffer.** A naive sweep called a 15-minute hole fillable because the shortest
> service is 15 minutes; the engine refused it, because 5m of padding either
> side makes the real requirement 25m. The measurement was wrong and the
> availability engine was right, which is precisely what booking through the
> real API exists to show. Occupancy reads 76% and 67% of remaining bookable
> time in appointment minutes alone; add the mandatory 5m and 10m padding and it
> is roughly 87% and 76%, with the rest being the six cancelled slots and
> fragments too short for any service.
>
> **The dispatch guard is demonstrated rather than asserted.**
> `createBookingAction` dispatches its own booking's messages immediately, so
> the guard ran 99 times: 73 confirmations and 26 `booking_pending` came back
> **`skipped`**, 70 future reminders and 6 `cancellation_confirmation` rows sit
> `pending`, and `sent_at` is null on every notification in the database.
>
> **`demo-nails` books everything as awaiting approval** — all 26 at the time
> of the run. Worth confirming that is the intended setting for that tenant.
> Only **one** of them is still `pending` today, so they were approved by hand
> afterwards; the run record above stands, the diary has simply moved on.
>
> **What it measured is worth more than the data it wrote.** Median from this
> machine against the Seoul database: **3.6s for a slot lookup and 9.5s for a
> booking** — the two calls a client's browser actually waits on. The absolute
> numbers include this machine's distance from the database and a deployed
> server's would differ with its region, but the round-trip *count* is the same
> wherever it runs, which is what makes the booking flow latency-bound on
> database proximity.
>
> Undo is `delete from appointments where client_phone like '056%' and
> client_phone not like '0560%'` — every number this script creates, and not the
> load-test batch, which has its own purge. The bare `'056%'` this line used to
> give now takes both.
>
> **`npm run db:seed:appointments` is the other one, and it is not that one.**
> `db:seed` *rebuilds* a demo tenant — it deletes every appointment, waitlist
> entry, client note and outbox row before it writes. That is right when the
> demos have drifted and wrong when the ask is "put some bookings in so I can
> talk to ליבי", because the reset takes the rest of the shop's state with it.
> The appointments seed only **inserts**: 6–8 believable bookings per demo
> spread over today plus five days, distributed across the open days rather
> than drawn at random (today is guaranteed — "כמה תורים יש לי היום" is the
> first thing anybody asks her, and an empty answer tests nothing), placed
> around whatever is already in the diary and around each other, inside posted
> hours, one client per person. It takes `--dry-run` too.

`demo-nails` having a **team** is the correction that changes behaviour, not
just a count: two providers put it in grid-mode availability and give the public
flow the provider-picker step, which is exactly the shape
`chooseProviderIfAsked` exists to absorb. A single-chair assumption about it is
wrong.

### The three rules a new session most needs

**1. What a tier buys.** `lib/entitlements.ts` is the only place that decides,
and it is pure. Starter owns the whole design surface **and WhatsApp** — sold by
allowance (`whatsappIncluded` in `lib/plans.ts`, 100 vs 350 a month) rather
than by switch. Pro adds `smsReminders`, `canAccessAnalytics`,
`clientRetention`, `canAccessLibi`, `prioritySupport`. `effectivePlan` resolves
in order: **frozen → `free`**, trialing → Pro, active → the stored tier, else
`free`. Frozen outranks a live subscription *and* a running trial. Never read
`plan_type` without the status and the freeze flag.

**2. WhatsApp sends Meta templates on the official path only, and seven kinds
now go.** Eight templates are registered and all eight are wired; the two
reminders share one kind. Only `client_winback` and `booking_rescheduled` are
left, and a kind with no template is **refused, not re-routed** — the channel
was chosen at enqueue time, so `retryable: false` means the client simply gets
nothing. `notifications/audit.test.ts` pins the deliverable list.

Three things that bite. Each component numbers its variables from 1
*independently*. **The `_he` suffix is not decoration** — `booking_pending` and
`cancellation_confirmation` hold the original **English** submissions, so the
Hebrew ones are `booking_pending_he` / `cancellation_confirmation_he` and using
the bare name would *deliver English*. And there are **three button-suffix
shapes**: `appointment_confirmation` takes a bare token against
`https://www.bazman.app/` and relies on `proxy.ts` redirecting `/{token}` →
`/b/{token}`; the four newer ones take the whole `b/<token>` path or the
**slug**; `waitlist_invite` has its own `/w/` base and a bare token, because an
invite token is a `randomUUID()` indistinguishable from a cancel token.

Three backends, preferred in order: **Meta Cloud API** → **Green API** → Twilio.
Green API sends **free text**, so kinds with no Meta template *do* deliver there
— "it reaches nobody" is true of the Meta path only.

**3. `/master` shows the tier a tenant is *served*, not the one stored.** They
diverge constantly — trialing, past_due and frozen all do — and the cell prints
the served tier plus the reason.

### Traps that cost a session each. Do not rediscover them.

| Trap | What happens | Where |
| --- | --- | --- |
| **The dedupe key omits the time** | `reminder:<id>:<hours>` is UNIQUE and `enqueueNotification` is an `onConflictDoNothing` **whatever the row's status**. Marking a reminder `skipped` and re-enqueueing queues *nothing*, so a moved or revived appointment silently loses its reminder. Delete the pending rows instead. | `deletePendingNotificationsForAppointment` |
| **A hand-written migration does nothing** | Drizzle runs `meta/_journal.json`, not the folder. `db:migrate` reports success while skipping an unregistered file — 0024 shipped that way and the table never appeared. | `db/migrations/meta/_journal.json` |
| **`db:seed` used to destroy uploads** | It deleted the business row and cascaded away the logo, hero, gallery, reviews and every `services`/`staff` `image_url`. It now clears **only** appointments, waitlist, client notes and the outbox. | `db/seed.ts` |
| **`db:seed` used to transfer ownership** | `resolveOwnerId` falls through to "reuse the oldest" when every account already owns something — which is this database. An existing demo now keeps its owner. Always run `db:seed -- --dry-run` first. | `ownerFor` |
| **`sql` aggregates decode differently** | postgres.js returns a string where PGlite returns a `Date`, so the suite proves the opposite of production. Convert with `toDate`; `.mapWith()` does not work in that position. Enforced by `sql-types.coverage.test.ts`. | `db/queries/sql-types.ts` |
| **`redirect()` signals success by throwing** | `unstable_rethrow` first, always, or a successful login reports a connection error. | `lib/call-action.ts` |
| **Waitlist expiry cycles only as often as the cron** | `vercel.json` is `0 8 * * *` because Hobby rejects anything more frequent — the real cadence is the GitHub Actions workflow hitting the same URL every 15 min. Offers still *lapse* on time (the clock is read on the page and in the claim action), but nothing is **re-offered** until a sweep runs. If that workflow is disabled, every lapsed slot dies silently. Never set a TTL below the sweep interval. | `.github/workflows/dispatch-notifications.yml` |
| **Custom properties compute where they are declared** | A token on `:root` bakes in the fallback and every tenant renders indigo. Accent-derived values must be real declarations on the element. | `.cal-glass`, `.accent-mesh` |
| **A hand-rolled upload copied the body and not the headers** | `image-upload.tsx` reproduces `supabase-js`'s multipart upload with `XMLHttpRequest` so it can show progress. `supabase-js` sends `cacheControl` **twice** — a form field *and* a `cache-control: max-age=…` request header — and only the field was copied, so every asset ever uploaded is stored with the API's fallback and served `Cache-Control: no-cache`. Verified on production: every logo, banner, gallery photo and hero video, on every tenant. The paths are UUIDs and a new upload mints a new one, so these are immutable by construction. Pinned by `media-upload.test.ts`. | `image-upload.tsx` |
| **A `quality` outside `images.qualities` is silently ignored** | Next 16 changed the default from "anything goes" to `[75]`. The optimizer answers `"q" parameter (quality) of 90 is not allowed` with a **400**, and `next/image` clamps the `q` it emits before the request is made — so the prop looks deliberate, the page renders, and every image is served at 75. Add the value to `images.qualities` or it does nothing. Nothing asks for 90 today — the landing page's phones are drawn in code since 2026-09-19 — and the list keeps it for the next image that does. | `next.config.ts` |
| **`priority` on `next/image` is deprecated in 16** | Replaced by `preload`. A deprecated prop is not a working one: the hero passed `priority` and rendered with `loading="auto"` and **no `fetchpriority`** — the same treatment as every lazy image below it. Check `node_modules/next/dist/docs` before trusting a remembered prop name. | `phone-frame.tsx` |
| **An empty inline-flex box grows the line it sits on** | The typewriter's heading got **taller** by 9px (390px) / 18px (1440px) on the frame its text emptied, pushing the paragraph and CTA down. A flex container takes its baseline from its first line box; with no text the browser synthesises one from the bottom margin edge, so the box drops and the parent's line box grows to hold it. `min-h` cannot fix it — the height was never the variable. A zero-width space restores the baseline; a non-breaking space would too, but it shoves the caret sideways by its own width. | `typewriter-logo.tsx` |
| **A `backdrop-filter` is a containing block for `fixed` children** | Like `transform` and `filter`, an element with a backdrop filter becomes the containing block for every `position: fixed` descendant — so `fixed inset-0` means *that element's box*. The «עוד» sheet rendered inside the frosted phone dock came out 331×48px-anchored: dock-wide, rising from the dock, its scrim covering nothing. Anything `fixed` whose trigger lives in glass goes through `createPortal(…, document.body)`. The calendar's hover card already escapes its cards (`backdrop-blur-sm`) by rendering at the root for the same reason. | `dashboard-nav.tsx` `MoreSheet` |
| **An unlayered `box-shadow` erases every focus ring** | Tailwind v4 draws `focus-visible:ring-2` as `box-shadow` through `--tw-ring-shadow`, inside `@layer utilities`. A plain `box-shadow` in `globals.css` is unlayered, so it wins outright and the ring silently never draws. Set `--tw-shadow` / `--tw-inset-shadow` and write the five-variable composition instead — every `.glass-*` and `.cal-glass*` rule does. And give `:focus-visible` a `0s` transition, or a `box-shadow` transition fades the ring in. | `globals.css` *LIQUID GLASS* |
| **A `Date` in a raw `sql` template throws — after everything before it committed** | Through Drizzle's postgres-js driver a `Date` parameter inside `` sql`…` `` reaches postgres.js unserialised and fails with `ERR_INVALID_ARG_TYPE` at runtime; typecheck is happy. The load-test runner's read-back hit it *after* its insert had committed, so the error read like a failed run. Query-builder comparisons (`lt(column, date)`) encode fine. In raw SQL pass `date.toISOString()` with `::timestamptz`. | `seed-load-test.ts` |
| **`cn()` deletes a `leading-*` that comes before a text size** | `tailwind-merge` treats Tailwind v4's `text-*` as carrying a line-height, so `cn("leading-tight", "text-[10px]")` silently returns `text-[10px]`. The calendar card rendered 15px lines for months under a line budget that believed 12, and every short card sliced its own text. Nothing warns: the class is in the source, only the runtime output lacks it. Put the line-height inside the size class — `text-[10px]/[14px]`, `text-xs/5` — which merges as one class. `calendar-layout.test.ts` fails on a bare `leading-*` in `EntryCard`. | `week-calendar.tsx`, `calendar-layout.ts` |
| **`position: sticky` does nothing inside `overflow-x-auto`** | CSS computes `overflow-y` to `auto` the moment *either* axis is not `visible` — so a horizontally scrolling wrapper is already a scroll container in **both** directions, and sticky resolves against it rather than against the page. With the wrapper at content height there is nothing to scroll within, and the header simply never sticks. Bounding the wrapper's height is what makes sticky work at all; it is not decoration around it. `overflow-x: clip` does not have this effect, but it does not scroll either. | the calendar's scroll wrapper in `week-calendar.tsx` |
| **A lockfile above `Frontend/` breaks the dev server** | Next infers the workspace root from the outermost lockfile. An `npm install` run at the repo root left `package.json`, `package-lock.json` and `node_modules/` there, and `next dev` then 500'd on every page ("Could not find the module … in the React Client Manifest"). `turbopack.root` in `next.config.ts` pins the root now; a stale cache after it needs `.next/dev` deleted once. **The root files were removed on 2026-09-19** (to the Recycle Bin); the pin stays as the guard against the next `npm install` run one directory too high. | `next.config.ts` |
| **A navigation can arrive with the same props** | The router may answer a navigation back to the range a page first rendered from its cache, with the very same prop objects — so state that follows "the server's range" by comparing props (dates *or* identity) silently misses it. The agenda stayed on Saturday after the dock's "היומן". The calendar and the agenda detect navigations on the URL, which every in-memory step keeps in step through `replaceState`. | `agenda-view.tsx`, `week-calendar.tsx` |
| **A tenant can write their own `businesses` row through PostgREST** | `businesses_owner_all` is `FOR ALL TO authenticated`, and `authenticated` holds every table privilege — so an owner with a session and the public anon key can `PATCH /rest/v1/businesses` and change any column of their own row, `plan_type`, `subscription_status`, `trial_ends_at` and `is_active` included. The app never writes that way (Drizzle, as the table owner), which is why nothing broke. **Only `whatsapp_enabled` is guarded** (0036's trigger); the rest needs a migration of its own — a trigger over the platform's columns, or column-level `UPDATE` grants — and a decision about which columns an owner may keep writing. | migration 0002, 0036 |
| **Repeated Playwright sign-ins trip the login limiter** | Each run of a temporary spec signs in afresh, and the fifth or so in a few minutes answers "נשלחו יותר מדי בקשות" — the spec then times out on `waitForURL`, which reads like a broken login. Wait two minutes. And hide `nextjs-portal` in a spec that presses ליבי's docked button: under `next dev` the tools badge sits exactly on it and swallows the click. | `e2e/helpers.ts` `signInAsOwner` |
| **Supabase Auth's client turns every 5xx into `{}`** | From auth-js 2.108 a 5xx is a transport failure: the message is `JSON.stringify(response)`, which is `{}`, and the body is never read. A project whose mail is broken therefore fails every sign-up with two characters, in the form *and* in the log. `createSupabaseServerClient({ onAuthServerFailure })` keeps the body; `usableMessage` refuses to treat `{}` as a message. Re-check on the next auth-js upgrade — `auth-failure.test.ts` fails when they start reading the body again. | `lib/supabase/server.ts`, `lib/auth-errors.ts` |
| **`next dev` prints Server Action arguments** | Next 16 logs every server-function call in development *with its arguments* — the sign-in action's included, the E2E password in plain text. Local only, but a dev log pasted anywhere carries it. **Off since 2026-09-19:** `logging.serverFunctions: false` in `next.config.ts`. Turn it back on only for a session that needs to see the calls, and not with a real account signed in. | `next.config.ts` |
| **Two moves cannot swap two bookings** | `appointments_no_overlap_staff` is not deferrable, so it is checked per statement: whichever booking moves first lands on the other while that one is still there, and a swap that is valid as a whole fails halfway every time the two share a provider. `swapAppointments` parks the first on an empty range (`ends_at = starts_at` — the empty `tstzrange` overlaps nothing), moves the second, then the first, in one transaction, each write a compare-and-swap on the start it was planned against. Making the constraint deferrable would need a migration and buys nothing this does not. | `db/queries/appointments.ts` `swapAppointments` |

### The guarantee everything else leans on

`appointments_no_overlap_staff` — `(business_id, staff_id)` over the non-terminal
statuses — is the **only** thing preventing a double booking, and it is not
optional. What follows from that:

- Any write to `starts_at`/`ends_at` goes through `rescheduleAppointment`, never
  a bare update, so a violation surfaces as `SlotTakenError`.
- The waitlist race is settled by it rather than by locking: everyone holding an
  invite link passes every check and exactly one insert survives.
- **`force: true` on a reschedule cannot waive it.** Force waives the *shop's*
  own rules — posted hours, breaks, notice. A same-provider clash returns a plain
  error naming the conflict, because being asked "are you sure?" and then failing
  anyway is worse than being refused.
- `pending` is non-terminal, so a request holds its slot. Deliberate: a request
  that reserved nothing is a request to be disappointed.

### Shipped, with the decision worth remembering

- **Full calendar** (`week-calendar.tsx`) — glass blocks in the tenant accent via
  `data-accent`; a staff hue overrides it on a team; **amber overrides both** for
  `pending`, whatever the shop's approval setting (0029 made per-service
  requests possible in a shop that takes none). Cancelled bookings are drawn
  muted while their slot is open (`withoutCoveredCancellations`); finished and
  no-show bookings carry marks. Cards stack three lines (name / time /
  service), and **the hour grows until the shortest booking holds all three**
  (`hourRowPx`): 96px an hour in the week and 160 in the day at base, 216 and
  304 when a quarter hour is on screen. Three lines cost **52px** once the
  border is counted and the lines are the 14px the browser draws; the earlier
  fixed `h-24` gave a quarter hour back to back one line, which is what the
  growing hour replaced — see *Liquid glass, round two*. `lineBudget` and
  `MIN_CARD_PX` still decide lines below ten minutes, capped so a floor never
  draws over the next booking. `gridMinWidthPx` sizes the grid from the widest
  lane count, so overlaps scroll rather than collapse. Compact grows to fit a
  first name and a start time; the overview fits the day to the frame in CSS.
  **The day/date row is pinned** while the hours scroll under it — an owner
  reading an 18:00 booking on a phone had nothing on screen telling them which
  day they were looking at. That needed the scroll wrapper's height bounded;
  see the `overflow-x-auto` trap above for why sticky did nothing without it.
- **The team switch keeps itself honest** — `has_multiple_staff` decides who is
  *bookable*, not merely what renders, so a roster and a flag that disagree
  produce a provider who is visibly on the rota and can never receive a
  booking. Adding **or reactivating** a second provider now turns the flag on by
  itself (`enableMultiStaffIfTeam`), and the action says so, because a switch
  that moves untouched has to be reported. Only the *on* direction is
  automatic: off is destructive, and must not fire because somebody was
  deactivated for a week. Turning it off keeps the **longest-serving** provider
  — earliest `created_at`, `longestServing` — and deactivates the rest.
  Deliberately **not** `primaryStaff()`, which leads with `sortOrder` and so
  with however the owner last arranged the list; the two agree wherever nobody
  reordered anything, since `sortOrder` defaults to `0` and the tie breaks on
  `createdAt` anyway. `staff-collapse.test.ts` holds the one case that
  separates them.
- **Two providers who picked the same colour** are told apart by **two cues on
  the same index** — `lib/staff-variants.ts`. A texture on the name dot that
  replaced the accent bar (`cal-dup-*`, `staffVariantClass`) and a deeper step of the same tint on the
  card body (`cal-tone-*`, `staffToneClass`). The bar answers the question once
  you are looking at a card; six pixels is not enough to answer it while
  *scanning* a week, which is what the grid is for, so the surface carries it
  too and a row of same-coloured providers reads as a ladder of one hue.
  **Strength, never hue** — the legend promises a card's colour is the dot
  beside that person's name, and shifting the hue would break that promise to
  keep a different one. The three bar patterns differ by **direction**
  (horizontal bands, diagonal stripes, dotted grid): they were two diagonals
  and a horizontal, and the two diagonals were nearly the same mark at 6px,
  so the thing meant to separate two people needed them side by side to read.
  Every rung of the tone ladder is measured by
  `calendar-glass-contrast.test.ts` — seven staff hues over six tenant accents,
  both themes, both views, all four steps — because a ladder that walked a
  surface under AA is exactly what that suite exists to catch. The **legend dot
  carries the texture** too, or distinguishing the cards just moves the
  question. Nobody with a unique colour sees any of it: variant `0` is the
  untouched bar at the base tint.
- **Staff cards carry their status on their edge** — emerald for active, rose
  for inactive, as a border plus a ring rather than a heavier border, because
  `border-2` would reflow every card in the list the moment somebody is
  deactivated. Colour is not carrying it alone: the name is struck through and
  the card's own button reads "הפעלה" instead of "השבתה".
- **ליבי** — a microphone in the dashboard layout, `/api/voice/process`,
  and a gradient ring around the viewport while it listens. Replaces the Apple
  Shortcuts endpoint, which is gone along with `siri_api_token`; 0031 dropped
  those columns, applied alongside 0032 and verified against production.
  **Authenticated by the owner's own session**, not a token: the caller is the
  dashboard they are already signed into, so `requireBusiness()` resolves the
  tenant exactly as every other route does and there is no new credential to
  mint, leak or revoke.
  **Reads run; destructive writes are asked about out loud, then applied.**
  `propose_cancel_appointment` and `propose_reschedule_appointment` find the
  appointment, read the client and the time back — *"מצאתי תור של דניאל כהן מחר
  ב-14:00. להזיז אותו למחר ב-17:00?"* — and return a **pending action** that
  changes nothing. The next turn's answer decides. The input is Hebrew speech
  transcribed by a model in a room with clippers running, `בטל` and `בדוק`
  differ by one consonant, and two clients called דניאל is an ordinary shop.
  An ambiguous name refuses and reads the times back rather than guessing.
  **The yes/no is a word list, not a prompt.** `libi-confirm.ts` is pure and
  tested, because putting the gate in front of every cancellation behind a
  generated sentence is exactly the thing that drifts with a model version.
  Three outcomes, not a boolean: anything that is not clearly a yes or a no
  abandons the pending action and is treated as a fresh turn, which costs one
  repeated sentence where guessing costs a client turning up to a shop that is
  not expecting them. Refusal beats agreement wherever both appear — "לא, אל
  תאשרי" contains a confirm word by accident. A yes over six words is not an
  answer but a new instruction. **The cancel verbs are deliberately not in the
  deny list**, and a test pins why: the pending action is usually *a
  cancellation*, so "כן, תבטלי" — the most natural way there is to agree to one
  — came back as a refusal while they were.
  **Nothing about the pending action is trusted.** The endpoint holds no session
  state, so it round-trips through the browser with the next recording, and
  `executePending` re-reads the row under the signed-in tenant before writing —
  an id from another shop resolves to nothing. It also re-checks the
  appointment's **start time**: a slot that moved between the question and the
  answer refuses rather than applying a confirmed change to whatever is there
  now, which is the collision the whole step exists for.
  **Creating runs on the first sentence, and the asymmetry is the point.** A
  booking takes an empty slot, tells nobody, and is undone with one tap on the
  calendar the owner is already holding; a move or a cancellation undoes an
  arrangement a *client* is relying on. So `create_appointment` writes and the
  `propose_*` pair ask. The tool-surface test enforces exactly that line.
  **A booking with no phone number is the normal case (0032).** Nobody dictates
  one, so the row is created with `""` and `is_voice_placeholder`, which does
  the job the owner wanted — it is non-terminal, so
  `appointments_no_overlap_staff` keeps an online client from booking over it —
  and is excluded from `listClients`, where every placeholder in the shop would
  otherwise fold into one phantom client whose visit count climbed each time the
  owner spoke. Service and provider fall back to the shop's own first-by-sort
  entries. *(Superseded: she now asks — which service when the shop sells more
  than one, and "אצל מי?" in a team shop. See* ליבי asks, swaps, and sees next
  week*.)* Availability is **not** consulted, matching
  `createManualBookingAction`: squeezing somebody in outside posted hours is
  most of what a shop's day is, and the guard that matters is the database
  constraint, surfaced as a sentence rather than a stack trace.
  **A frozen tenant is offered the reading tools only** — withheld rather than
  refused, so the model explains the situation instead of announcing a booking
  that did not happen. The route carries that check itself rather than calling
  `requireWritable`, which *redirects*: a login page arriving where a JSON line
  was expected.
  **A clash is found by a read, and named.** The exclusion constraint can
  only say no; `conflictFor` says *who* — "יש כבר תור בטווח הזמנים הזה
  לרועי אביטן. תרצה לבחור שעה אחרת?" — which is the difference between an
  owner going to look and an owner knowing. The whole **range** is checked,
  not the start: a 45-minute cut booked at 14:30 runs into a 15:00 booking
  even though nothing starts at 14:30. The read is in *front* of the
  constraint and never instead of it — two requests can both pass it and only
  one insert survives, so `SlotTakenError` is still caught and still spoken.
  For a move the clash is found **when she asks**, not after the owner has
  agreed: checking only on execution would spend a confirmation on a move
  that was never possible. The row being moved is excluded from its own
  check, because a fifteen-minute nudge overlaps its own former range and an
  exclusion constraint never compares a row against itself.
  **Opening hours do not bind her, and the prompt had to say so out loud.**
  This path never consulted availability — matching `createManualBookingAction`
  — but the live check found the *model* refusing anyway: asked to book at ten
  at night it answered "אין תורים זמינים", a sentence from no tool and no
  string in this repository, and called nothing. It was reasoning about the
  client-facing availability engine. The prompt now states that the hours do
  not limit her and that only the tool decides a refusal; re-checked live, the
  same utterance books 22:00.
  **The prompt was cut to what changes an answer.** 3787 → 3055 characters of
  instructions plus tool schema, the instructions themselves 1206 → 758. The
  trigger verbs moved into the tool descriptions, which is what
  function-calling actually matches on — carrying them in both places paid for
  the same tokens twice and gave the model two places to disagree with itself.
  `parallel_tool_calls: false` (only `tool_calls[0]` is ever run) and
  `max_tokens` 200 → 120. Worth being honest about the size of this: a turn is
  dominated by Whisper, the intent model and ElevenLabs v3 at ~3.0s on its
  own, so trimming the prompt is a real saving on tokens and a small one on
  the clock. The structural win already existed — a confirmation turn returns
  from `libi-confirm` before either the roster query or the model call.
  **She remembers the last few turns, and that is what makes "תזיז אותו"
  mean something.** The endpoint still holds no session state: the
  conversation rides with the recording, exactly as the pending action does,
  because a server-side store for something that lives ninety seconds is a
  second lifetime to manage and a second thing to get wrong on a deploy where
  the next turn is a different instance. Bounded on the way in — four
  exchanges, 45 seconds of inactivity, 300 characters a side — and the age rule
  is the one that matters: a tab picked up after lunch is a new conversation, and a
  pronoun reaching back across that gap is how the wrong appointment gets
  cancelled. A malformed history is dropped **whole** rather than repaired,
  since a gap in the conversation is precisely where a reference goes wrong.
  **Untrusted, and safe to be.** It arrives from the browser and can say
  anything; what stops that mattering is where authority actually lives —
  every tool resolves under the signed-in tenant, `executePending` re-reads
  the row, and the confirmation gate reads the *current* transcript through a
  word list that never sees this. A forged history can make her say something
  odd. It cannot reach another shop's diary, and it cannot confirm anything.
  The roster is still read fresh every turn, so history is context for
  *reference* and never for fact.
  **The pronoun becomes a name, not an id.** The model resolves "אותו" from
  the previous assistant message into a client name and the tool looks it up
  itself — so the ambiguity guard that refuses two clients called דניאל still
  runs on whatever the model decided.
  **The microphone re-opens on `onended`, not on the answer.** The reply is on
  screen about three seconds before it finishes being spoken; re-opening then
  would have the analyser hear her own voice through the speaker, latch, and
  cut the owner off before they had said a word.
  **A turn nobody asked for gets a deadline.** `decideSilence`'s latch never
  stops a recording before somebody has spoken — right for a pressed turn,
  wrong for one that opened by itself, where it would hold the microphone to
  the twenty-second cap and then send seven seconds of shop to Whisper.
  `idleOutcome` closes the conversation instead — after 4.5 seconds with nothing
  heard on a turn that re-opened by itself; a pressed turn waits 8 and then
  sends (see *ליבי in a loud shop*). סגור ends it by hand, and closing either
  control forgets the history with it.
  **The reply is spoken in pieces, because the owner waits for the first word
  and not the last one.** `eleven_v3` charges roughly linearly: measured warm
  against the live endpoint, a two-sentence reply took **3721ms** before a
  single byte could be played, and the same text requested as two sentences
  put the first in the owner's ear at **1946ms** — finishing the lot at 3084ms,
  so it is not even a trade. `libi-chunks.ts` decides where to cut and
  `speakChunks` asks for all of them at once, so the second is being generated
  while the first is in the air. One NDJSON audio line per piece, `last` on the
  final one — which is also what now tells the client when the microphone may
  reopen, a job that moved out of `play`'s `onended` when one clip became
  three.
  **The `/stream` endpoint is a different request, not the same one with a
  flag.** Headers at 980ms and the last byte at 1562ms, against 2652ms and
  2657ms for the plain endpoint on identical text. The body is still buffered,
  because the browser plays these through `decodeAudioData`, which needs a
  complete file — the incremental half of the problem is solved by asking for
  the answer in pieces instead. `voice_settings` is `{ stability: 0.4, speed:
  1.1 }`: a tenth off every reply is worth having when somebody is standing
  still through it, and the lower stability keeps the question intonation that
  makes "?להזיז אותו" a question rather than an announcement.
  **The colon earned its place in the splitter by measurement.** The first cut
  split only on `.!?`, and the concision rules had already made most replies a
  single sentence introducing a list — "מחר יש לך שלושה תורים: הראשון ב-09:30"
  — with no sentence end in them at all, so the chunking never fired on the
  answers long enough to need it. Adding `:` took a 74-character reply from one
  clip to two and its turn from 9.3s to 6.1s. Whitespace after the mark is
  required, which is what keeps a clock time out of it.
  **What was asked for and is not there: streaming the *model*.** The brief
  asked for the LLM's first clause to be piped to TTS before the response
  completes, and on this pipeline that does not compose. The spoken sentence
  almost never comes from the model — it comes from a tool, which returns it
  whole and at once, and `tool_choice: "auto"` means nothing can know whether
  the model's own text will be used until the tool decision has arrived.
  Speaking it early would mean speaking text that is then discarded. The
  latency it was meant to buy is bought instead by splitting the finished
  answer, which works identically on both paths.
  **The card puts itself away.** Four seconds after a conversation ends —
  roughly twice the time it takes to read a sentence that has just been spoken
  aloud — with a `motion-safe` fade long enough to read as being put away
  rather than as a glitch. Any new turn cancels a pending dismissal, and a card
  carrying a **pending change is exempt entirely**: that one is a question with
  a button on it, and a question that vanishes while somebody is deciding is
  worse than one that lingers.
  **The brand's stress moved to the last syllable.** `בַּזְמַן` had the right
  vowels and the wrong weight — a patah under the final מ is a short vowel
  Hebrew tends to read as unstressed, giving BAZ-man. `בַּזְמָן` is the qamatz
  that carries the stress: baz-MAN, as in "בול בזמן".
  **Two bugs found while measuring, both unrelated to the change.**
  *"ומה יש לי מחר"* routed to `get_today_summary` and came back with **today's**
  diary — wrong information about the calendar, which is the worst failure this
  feature has. The tool description now says what it is *not* for and the
  prompt names the trap; re-checked live, the same question answers about
  tomorrow. And Whisper prefixes Hebrew transcripts with U+202B often enough to
  matter — it arrived as `\u202bומה יש לי מחר?` — so bidi controls are stripped
  in `transcribe`. They are invisible in every log and every diff, which is
  exactly what makes them worth removing rather than reasoning about.
  **A mis-heard word is fixed in the decoder or not at all.** By the time the
  intent model sees "כהלי" the audio is gone — no instruction downstream
  recovers which word was said, it can only guess, and a guess is how a
  booking lands under a name nobody has. The transcriber is now told what to
  expect — `keywords` carrying the shop's upcoming clients, staff and services,
  and a context sentence with ליבי's last line; the word-list prompt this
  paragraph used to describe is gone, and *ליבי in a loud shop* has the
  measurement. A small correction map runs after, whole words only —
  and written out rather than with `\b`, which JavaScript defines against
  `[A-Za-z0-9_]` and which therefore does nothing beside Hebrew.
  **The buffer rule went in the prompt because the code already allowed it.**
  `create_appointment` never consulted availability — it checks for a genuine
  overlap and lets the exclusion constraint settle the rest — so a fifteen
  minute gap between 15:05 and 15:20 was always bookable. What refused it was
  the *model*, reasoning about padding that belongs to the client-facing
  engine and not to the owner, exactly as it once invented "אין תורים זמינים"
  for a booking after closing. The minute forms went in beside it: "שלוש
  וחמישה" is 15:05, and a model that renders it 15:00 books over somebody
  while one that gives up says there is no room — neither looks like a parsing
  problem from the owner's side.
  **The overlapping cards were a floor with no ceiling.** `placeItem` lifted
  every card to `MIN_CARD_PERCENT` so a 15-minute booking on a twelve-hour
  grid was not a hairline — unconditionally, so back to back that extra 0.42%
  was three minutes of card drawn over the next one's start. `cardHeightPx`
  had always capped its pixel floor at the gap to the next booking; the
  percentage twin simply never learned to, and `summary`'s fixed 8px floor
  never had either. Both now cap. Verified in a browser on the seeded week: 45
  cards, **zero pairs spilling into the one below**.
  **Cards that looked stacked, and three causes behind one symptom.** That
  verification was right about what it measured and missed what the owner saw.
  Re-measured on the same week: boxes still never intersected, but **16 of 40
  vertically adjacent pairs touched at exactly 0px**, and every short card's
  last line was sliced in half with the next card's border sitting on the cut —
  which reads, precisely, as one card laid on top of another.
  *The line budget promised lines the card did not have.* The card's classes
  said `leading-tight`; `cn()` is `tailwind-merge`, which **deletes a
  `leading-*` utility when a text size follows it**, because in Tailwind v4 the
  size carries its own line-height. So lines rendered at the inherited 15px
  while `CARD_METRICS` believed 12, and the 1px border top and bottom was never
  counted. The surplus lines did not overflow — they are `truncate` flex items,
  and `overflow: hidden` resets a flex item's `min-height` to zero — so each
  one was *squeezed*, clipping its own glyphs. Invisible to `scrollHeight`,
  which is why a browser check that looked for overflow found nothing.
  *Flush was a decision, and it was the wrong one.* The caps stopped each floor
  exactly at the next card's start, and a comment defended that. `CARD_GAP_PX`
  (2px) now comes off the bottom of **every** card in `cardBox` — never the top,
  which is where the eye reads *when* — so back-to-back and zero-buffer
  bookings separate too, which no cap could ever do.
  *And a real overlap the old check could not see.* `gapsToNext` grouped by
  lane **number**, but lanes restart at zero in every overlapping group and a
  group of one is full width: a short card in lane 1 found nothing below it,
  went uncapped, and ran into the full-width card opening the next group.
  Latent on a one-chair week; the fuzz below reproduces it at up to 47px in the
  day view, on the shape a cancelled row beside its replacement makes. "Below"
  now means *sharing horizontal space*. `summary`'s cap was also measured on the
  week's 96px hour while it draws on a 48px one — every floor now lives in
  `calendar-layout` beside the cap, measured on the grid the card is drawn on,
  and `DENSITY.*.minCardPx` is gone.
  **Heebo sets the line box, not taste:** measured in the browser, its ink at
  10px needs a **14px** line box before `truncate` shaves accents off É and Ñ —
  so the 12px the metrics assumed would have sliced glyphs even had
  `leading-tight` survived. The line-height now rides inside the size class
  (`text-[10px]/[14px]`, `text-xs/5 sm:text-sm/5`), where `tailwind-merge`
  cannot split it off; every line is `shrink-0`; a one-line card uses tight
  padding so a back-to-back quarter hour shows a whole name. Floors are derived
  from the metrics: **52 / 74 / 34 / 8px** for week, day, compact, summary.
  **Guarded by tests that were watched failing.** A seeded fuzz draws 3000 dense
  days — parallel chains like two providers, 0/5/10-minute buffers, duplicate
  slots — in all four frames and requires every card to clear every later card
  sharing its space by 2px. Mutation-tested: grouping by lane number fails it,
  and so does a zero gap, **after** the first version of the test passed a zero
  gap because it measured clearance against `CARD_GAP_PX` itself; the
  requirement is now a literal. A sweep proves `lineBudget` returns the most
  lines that fit and never one that does not, the card's classes are
  transcribed against the metrics, and a bare `leading-*` anywhere in
  `EntryCard` fails the suite.
  **Verified in a browser:** two seeded weeks × three densities + day view ×
  1440px and 390px — **0 intersecting pairs, 0 pairs under 1.5px apart,
  minimum clearance 2.0px, 0 squeezed lines**, down from 16 touching pairs and
  a sliced line on every short card. What it costs is stated in the *Full
  calendar* bullet above: short back-to-back bookings show fewer lines, whole.
  `demo-nails` — where two providers make side lanes an everyday shape — could
  not be signed into; the E2E credentials own `demo-barber` only, so the lane
  fix is proven by the fuzz and by construction rather than on that screen.
  **ליבי's ring had no timeout at all.** The id lives in `?focus=`, so a
  highlight stayed until the owner navigated — long after the sentence that
  caused it. Eight seconds or the next click, whichever comes first, and the
  URL is cleaned up with it so a refresh does not bring back a marker already
  dismissed. Stored as the *dismissed* id rather than the shown one, so the
  ring is derived and nothing writes state from inside an effect.
  **A lane that never shares its column does not need a sharing width.**
  `MIN_LANE_PX` is sized for two or three cards side by side; a single-staff
  week is one lane every day, and at that width seven columns overflow a
  laptop and the owner scrolls sideways through their own week. `SOLO_LANE_PX`
  applies only where every day is single-lane, and as a **cap** — `compact`
  and `summary` drew their widths for this problem and keep them. Measured in
  a browser at both widths: **nothing horizontally clipped at either**, so the
  narrowing bought the seventh column without trading a scrollbar for an
  ellipsis. The "·" endings on short cards are `lineBudget` dropping the
  service on a *vertically* short card, which is height-driven and unchanged.
  **Where a booking came from is now a column (0034).** `created_via` is
  `online`, `manual` or `voice`, stamped by the three write paths, coerced by
  `appointment-origin` before anything renders it. `text` rather than a
  boolean because `created_by_livi` would answer one question and close the
  door on the next. Only `voice` marks the card, and it survives `compact`
  where the note marks do not: those are footnotes, while this answers *did
  that spoken sentence actually become a booking* — the newest route in and
  the one an owner is still learning to trust. Distinct from
  `is_voice_placeholder` (0032), which means only that no phone number was
  dictated.
  **Two `demo-barber` bookings in production were flipped to `voice` by hand**
  so the icon had something to render while it was being checked. Nothing
  spoke them into existence. Undo is
  `update appointments set created_via = 'online' where created_via = 'voice'`,
  which is safe today because Libi has booked nothing real yet — check that is
  still true before running it.
  **The microphone never actually reopened, and the reason is worth keeping.**
  `play`'s `onended` set the phase to idle and then asked `start` to take the
  next turn — but `setPhase` is queued and the call is not, so `start` ran
  inside a closure captured while the phase was still `"speaking"`, hit its
  own `if (phase !== "idle") return`, and did nothing. Every conversation
  stopped dead after her first answer, silently, with the card still on screen
  saying she was listening. Nothing threw, nothing logged, the typechecker was
  happy, and it shipped behind an honest note that the loop had not been
  driven with a real microphone. `phaseRef` is the fix: a ref updates
  synchronously, so the guard reads what the line above it just wrote, and
  `phase` leaves `start`'s dependencies — which is what made the closure stale
  to begin with. `libi-loop.test.ts` reads the component source and pins it,
  in the idiom `calendar-density.test.ts` already uses: there is no jsdom here,
  and standing up a `MediaRecorder`, an `AudioContext` and an animation frame
  to assert one `if` would be a lot of machinery guarding a little code.
  **ליבי addresses the owner in their own forms (0033).** Hebrew conjugates
  the second person by gender, so there is no neutral way to say "would you
  like me to update it" — it is either תרצה or תרצי, and a product that picks
  one unasked is wrong for about half the shops it runs in, every turn, out
  loud. `libi_address_gender` on `businesses`, a two-button control in
  settings that saves on click, and a prompt line that lists the actual
  conjugations rather than naming the gender — "address the owner as female"
  is an instruction a model can agree with and then drop three words later.
  The vocabulary lives in `libi-address.ts` rather than `libi-config.ts`
  **because nothing about it is a secret**: that module reads the API key and
  `voice-isolation.test.ts` forbids a client component from importing it, a
  rule worth keeping literal even though a type-only import is erased at
  build time.
  **Worth being straight about its reach.** Almost everything ליבי says comes
  from fixed tool strings that do not address the owner at all — "מצאתי תור
  של דניאל כהן מחר ב-09:30. לבטל אותו?" has no second person in it — and the
  concision rules from the previous pass made her model-authored sentences
  short enough to avoid one too. Probed live in `female` mode across four
  utterances and not one produced a gendered verb. The setting is wired,
  coerced twice and pinned by `libi-address.test.ts`; what it currently
  changes is small, and making it matter would mean gendering the tool
  strings, which is a larger change than the brief asked for.
  **"תראי לי את התור" moves the screen.** `show_appointment_in_calendar` is a
  read that also navigates: it resolves a day, an optional time and an
  optional name to one booking, and returns a path the client pushes.
  A stated time picks the **nearest** booking that day rather than an exact
  match — a diary is full of times nothing starts precisely at, and refusing
  to show anything because 16:00 is really 15:45 is a correct answer to a
  question nobody asked. With no time it takes the day's first and says how
  many more there are, which is the brief's own answer to the ambiguous case
  and better than asking: the owner is looking at the day a second later
  anyway. The href is assembled from the row's own date and id, never from
  anything the model wrote. `?focus=` rings the card and scrolls it into
  view; matched on `appointmentId` rather than `id`, since a booking crossing
  midnight is two cards sharing one row. Verified end to end: the card is
  present, ringed and in the viewport after following her.
  **The brand is pointed before it is spoken.** Unpointed בזמן is two words
  and the wrong one is the common one — בִּזְמַן is "in time" and the reading a
  TTS model reaches for first, so the shop's assistant mispronounced the
  shop's software in the one sentence a client might overhear. Fixed with
  niqqud rather than a respelling, so the letters stay the brand.
  **The auto-listen window is 4.5 seconds, and it is a window rather than a
  pause.** Long enough to draw breath and start a follow-up, short enough
  that a conversation nobody continued closes while the owner is still
  looking at the screen — so the microphone shutting is something they see
  rather than something they discover. Anyone who needs longer presses the
  button, which has no idle timeout at all.
  **Memory is four turns or 45 seconds of silence, and the second one is
  measured on the gap.** A rule that dropped turns *older* than 45 seconds
  would dismantle a conversation from underneath itself: a turn costs nine to
  twelve seconds, so by the fourth exchange the first would have aged out and
  "אותו" would point at nothing, mid-flow, for no reason the owner could see.
  What expires is the gap — while the exchange keeps moving the whole of it
  stays, and the moment it stops the context goes whole rather than eroding.
  `boundHistory` sorts before applying either rule, since "the newest turn"
  and "the last four" both assume an order a crafted request need not have.
  **The card and the voice now get different text.** "17:30" is exactly right
  to read — precise, scannable, the format the calendar uses — and wrong to
  hear: a TTS engine handed digits and a colon reads digits and a colon.
  `libi-hebrew.ts` runs on the way to the speaker and nowhere else.
  **Number gender is the load-bearing part.** Hours agree with שעה, which is
  feminine — "שלוש", never "שלושה" — while days of the month take the
  masculine, "שבעה בספטמבר". The two are adjacent in the same sentence and
  disagree by design. Two takes the construct form in front of a noun ("שני
  תורים", never "שניים תורים"), and one is left alone because Hebrew puts it
  *after* the noun. Getting any of this backwards does not garble the
  sentence; it produces fluent Hebrew that sounds like a foreigner reading a
  form, which is what the ElevenLabs switch existed to fix.
  **Conservative on purpose:** only a clock time, a date, and a count
  standing in front of a noun this product uses. A bare number is left as
  digits, because "45" could be a price, a duration, a house number or a
  year, and a confident wrong guess said out loud is worse than a digit read
  plainly. One trap worth recording — **`\b` cannot express a Hebrew word
  boundary**: JavaScript defines it against `[A-Za-z0-9_]`, so `\b` after a
  Hebrew letter asks for a transition a following space cannot provide and
  the pattern silently never matches. Written out as "not another Hebrew
  letter" instead, with a test that fails the obvious version.
  **The prompt now carries a number rather than an adjective.** "Be concise"
  is not a length; 15–20 words is. Every word she says is a word the owner
  stands still through twice — once while ElevenLabs encodes it, once while
  it plays — so politeness costs about a second a turn. Farewells are
  forbidden alongside preambles: "במה אוכל לעזור עוד?" is a sentence they
  wait to hear *after* the answer, into a microphone that has already
  re-opened. The vocabulary is bounded to the diary — תור, פנוי, מוזמן,
  מבוטל, הוזז — because she is not a general assistant with calendar access;
  she is the calendar, spoken.
  **The word cap needed the list rule to be concrete before it held.** Asked
  what was on tomorrow she answered in 27 words, enumerating all three
  bookings, while a prompt that said both "be brief" and "do not read lists"
  sat above her. Naming the threshold — more than two, say how many and the
  first and last only — took the same question to 11 words. Measured live
  across four turns: 10, 11, 9 and 7 words, with every time, date and count
  spoken rather than spelled.
  Verified live as a conversation: *"מה התור הבא שלי"* → 16:30 עם עומר לוי;
  *"תזיזי אותו בשעה קדימה"* → resolved the pronoun **and** the arithmetic,
  proposing 17:30; *"כן"* → applied, on the fast path that skips both the
  roster query and the model.
  **Two defects the live run found, both now fixed and pinned.** Whisper
  returned **"כאן"** for "כן" — near-homophones, one syllable, noisy room —
  so the confirmation fell through and she asked the same question again,
  invisibly. It is now accepted, but *only as a whole utterance*: "כאן" means
  *here*, and inside a sentence it is left alone. And asked what was on
  tomorrow she read the prompt's own context format **aloud** — middots,
  hyphens and the English word `confirmed`. The prompt now forbids reading a
  list at all; the same question now answers in spoken Hebrew prose.
  Verified live end to end against the built server: *"תקבעי תור לדני מחר בשעה
  שלוש"* booked a placeholder at 15:00 and said the tip; *"תזיזי את התור של דני
  מחר לחמש"* described the move and changed nothing; *"כן"* applied it. A fourth
  turn is worth recording because it failed in the right direction — Whisper
  heard "תבטלי" as "תיבט לי", so the model chose `find_client_appointments` and
  a mis-heard cancellation came back as a **read**.
  **The tools stay authoritative; the diary fills the gaps.** The prompt now
  carries the shop's date and time and a bounded roster — today plus seven days,
  capped at 25 rows, **never a phone number**, cancelled and no-shows filtered
  out before they can be read back as booked. That is a real change to the
  bargain and worth stating: until now the model could not assert a fact, only
  choose a tool whose Hebrew came from `libi-speech`. It can now answer things
  no tool covers ("מה יש לי ביום חמישי?"), and in exchange it can say something
  no test wrote. Three things narrow it — the prompt orders tools first and says
  so, `temperature: 0`, and the context is a literal transcription of rows with
  "this list is complete" stated, so "I do not see it in the diary" is an
  available answer. Verified live: *"מה התאריך היום?"* → answered from the clock
  with no tool, *"מה יש לי ביום חמישי?"* → answered from the diary with no tool,
  *"כמה תורים יש לי היום?"* → still routed to `get_today_summary`.
  The clock was the half that was simply absent — a model has no idea what day
  it is, so every "היום" and "מחר" was previously a guess.
  **Speech out is ElevenLabs, with OpenAI as the floor.** `tts-1` reads Hebrew
  as a foreign language and it is audible in every reply — the one part of this
  product a shop's clients might overhear. `ELEVENLABS_API_KEY` +
  `ELEVENLABS_VOICE_ID` switch it; **both or neither**, because a voice id is a
  path segment and a key without one is a 404 on every turn, so a half
  configuration stays on OpenAI rather than going mute. There is deliberately no
  default voice id: an arbitrary premade voice billed to the shop's account is
  worse than falling back.
  The fallback fires on **failure as well as absence** — a quota, a revoked key
  or an outage costs a foreign accent for one sentence instead of silence, and
  is reported so a broken configuration is visible in a log rather than only
  audible to whoever is standing there. Verified both ways: the two providers
  are distinguishable at the byte level (ElevenLabs emits an `ID3` header,
  `tts-1` a raw MPEG frame), and a turn with the key removed came back with the
  OpenAI shape and no lost answer.
  **`eleven_v3` is the default, and it is the slow one.** Measured warm, three
  runs each, median: `eleven_v3` **2962ms**, `eleven_multilingual_v2`
  **1196ms**, `eleven_turbo_v2_5` **570ms**, `tts-1` **1950ms**. So the default
  is the one option here slower than the OpenAI voice it replaced, and it was
  still chosen: v3 is the most expressive reader of the three, and this is the
  one part of the product a shop's clients overhear. It costs ~1.8s a turn
  against the multilingual model, on a turn that also pays for Whisper and the
  intent model — measured end to end at ~10s. The first ElevenLabs call of a
  process is ~10s of cold start and is not representative — do not tune on it.
  `ELEVENLABS_MODEL_ID` picks between the three, and `eleven_turbo_v2_5` is the
  answer if a turn ever feels slow. **An unknown value coerces to the default
  rather than erroring**, which is the trap this file should name: get the
  default itself wrong and every turn fails over to OpenAI silently — the accent
  the switch existed to remove, restored by default and audible only to whoever
  is standing there. That is why `eleven_v3` was proved against the live
  endpoint before it became the default rather than after.
  `OPENAI_TTS_VOICE` still governs the fallback's voice, defaulting to `nova`.
  **Two things a browser found that no unit test could.** The app's own
  `Permissions-Policy` header said `microphone=()` — closed to this origin too —
  so `getUserMedia` was refused by our own header and reported as a console
  violation rather than a prompt; it is now `microphone=(self)`, camera and
  geolocation still shut. And the ring's mask needs `mask-composite: exclude`
  with the `-webkit-` pair written *first*: the other order let Chromium apply
  an invalid `xor`, drop the composite, and paint the gradient across the entire
  viewport.
  No Framer Motion and no OpenAI SDK: the ring is a conic gradient swept by an
  `@property` angle, and the three model calls are `fetch` with the runtime's
  own `FormData`. A 50KB animation library on a dashboard that ships 19KB, to
  animate a border the compositor animates for free, is not a trade worth making.
  **`OPENAI_API_KEY` is set**, so the microphone does
  render. **Measured live end to end**: Whisper heard three Hebrew utterances,
  `gpt-4o-mini` chose the right tool for each, and TTS returned 31–48KB of mp3
  — and the turn is now three separate waits rather than one.
  **The reply streams as two NDJSON lines**: the card renders off the first,
  about a second before the voice arrives on the second (measured: card at
  7.45s, audio decode at 8.47s). A stream rather than a second endpoint, so
  the sentence is not shipped back to be spoken and there is no route that will
  read any text a signed-in caller hands it.
  **The recording ends when the speaking does** — an `AnalyserNode` sampled per
  animation frame, reduced to RMS, stopping after 1.8s of continuous quiet.
  Measured against a 1.54s utterance the recorder ran 3.337s: exactly 1.800s
  after the speech ended. The latch in `libi-vad.ts` is the load-bearing part —
  nothing may stop before the level has crossed the threshold once, or a quiet
  room closes the microphone before the owner has drawn breath. The 20s cap is
  now a backstop rather than how a turn normally ends. *(Superseded: the fixed
  RMS threshold ran every noisy turn to that cap. The detector is now
  room-relative and the caps are 15s and 10s — see* ליבי in a loud shop*.)*
  **Audio output is unlocked on the press**, not on arrival. A reply lands six
  to nine seconds after the tap, by which time the gesture no longer counts for
  an autoplay policy — which is why the `<Audio>` element this replaces was
  refused intermittently, most often on the mobile browsers the feature exists
  for. An `AudioContext` resumed inside the gesture stays running for the life
  of the page; `unlockAudio()` is called *before* `await getUserMedia`, because
  that await is long enough to lose the activation.
- **The week grid has three densities** — `lib/calendar-density.ts`, chosen from
  a three-icon switcher beside the day/week toggle and remembered in
  `localStorage`. The problem is arithmetic: `gridMinWidthPx` reserves 144px a
  lane so a card is never an ellipsis, and six days of one lane is **912px** —
  two and a half screens of sideways travel on the 390px phone this is opened
  on, for the one view whose question is "how full am I this week".
  `standard` keeps 144 and is asserted byte-identical to the grid that predates
  the switcher; `compact` drops to 42 and truncates the card to a name and a
  start time; `summary` drops to 20, halves the hour row and draws no text at
  all — a block of colour whose tap opens the same dialog.
  **Sized against the content box, not the viewport.** A 390px phone leaves
  356px inside the dashboard's padding, and the first cut of this measured
  against 390 — so the unit test passed while the browser scrolled 28px, which
  is exactly the failure it was written to prevent. Verified in the browser at
  320/360/390/430: page overflow is **0px everywhere**, and on a single-provider
  shop compact and summary both fit a **seven**-day week with nothing to scroll.
  A two-provider week needs two columns a day and still scrolls in compact —
  that is what summary is for, and past three providers it scrolls there too.
  **It is a preference, not a viewport**: offered at every width, because a
  control that disappears above a breakpoint strands whatever it last set, and
  because this grid deliberately measures nothing at runtime.
- **The provider picker is shown whenever there is anybody to assign**, in the
  move dialog and in manual booking, where it used to need a team of two before
  it appeared at all. `createManualBookingAction` had always accepted a
  `staffId` and resolved it through the business; nothing in the UI offered
  one, so every manual booking silently went to `getDefaultStaff` — on a team,
  a booking quietly given to whoever sorts first. With one provider the field
  reads as a statement rather than a choice, and becomes a choice the moment a
  second exists.
- **Opening a panel focuses the panel, not its first field.** The edit and move
  forms called `firstFieldRef.current?.focus()` on mount, which on a phone
  opens the keyboard over the form the owner just asked to see — or, in the
  move form, springs a date picker. Dropping the call outright is the wrong fix:
  the control that was focused has just been replaced, so focus falls to
  `<body>`. The form takes `tabIndex={-1}` and the focus instead, which keeps
  the announcement and the tab order without asking any device for text input.
- **One rule turns a phone number into a WhatsApp link** — `lib/whatsapp-link.ts`,
  composed on top of `normalizePhone` rather than beside it. There were four
  copies: `toE164` (correct) in the clients directory, and three inline
  strip-and-swaps in the dialog, the hover card and the waitlist manager. The
  inline ones were **wrong for a `00972…` number** — they read the leading zero
  as a trunk code and produced `9720972…`, a chat with nobody. `whatsappHref`
  returns `null` rather than a broken href, because a manual booking may carry
  no phone at all. The agenda card on `/dashboard` now offers it beside the
  call button; every other surface already did.
- **Approving a request updates every component on the click**, not on the
  refetch — `appointment-status-store.tsx`. The same request is on the dashboard
  **twice**: in `PendingRequests`, which spans days, and in the agenda for that
  day below it. Each row held its own `useState`, so approving one left the
  other showing `pending` with a live approve button on an already-approved
  booking, and the panel heading counted from the server prop. That was the
  "delay" — the write returned immediately; three components disagreed while
  they waited. The optimistic value now lives above both. **The server stays
  authoritative**: an override is dropped the moment the revalidated props carry
  the same value, so a stale local answer cannot mask a change made from another
  device. The hook falls back to local state when no provider is above it, so
  `AgendaList` still works anywhere.
- **Appointment dialog** — two tabs, booking and client card. Reschedule re-runs
  availability with the appointment excluded from its own busy set, or it blocks
  itself. Amber confirm sends `force: true` for off-hours.
- **Ambient ground + the arrival bug** — three accent blobs drift behind
  `/[slug]`, **transform-only** so they composite on the GPU rather than
  repainting a full-viewport layer on the five-year-old phone this is opened
  on; `booking-page-shell.test.ts` bans the repainting properties from the
  keyframes outright. Reduced motion settles them *at rest* rather than
  removing them — the colour is the tenant's identity, only the movement was
  the question — and `[data-a11y-still] *` already stops them for free.
  **The page used to scroll past its own hero on arrival**: `step` starts at 1,
  so the step effect fired on mount and threw away the logo, banner, name and
  hours before anyone saw them. Guarded by a ref rather than `step > 1`, so
  going *back* to step 1 still scrolls. The hero's seam fade now ends on
  `--background`, the exact value `.ambient` paints, instead of a hardcoded
  white that became a visible band the moment the ground was tinted.
- **Booking-page dressing** (0027) — four owner controls: card surface
  (`elevated` / `glass` / `flat`), corner softness, service layout
  (`compact` / `showcase`), and a 0–90 hero overlay. Names not values, arriving
  as `data-card` / `data-corner` on the page root, exactly as `data-accent`
  does — `lib/appearance.ts` owns the names, `globals.css` owns the looks, and
  `appearance.test.ts` reads the stylesheet to assert the two agree. Every
  coercion is total, so a text column written past the app still renders.
  **`showcase` degrades to `compact` when no service has a picture**, because a
  column of empty frames is worse than the list it replaced; the setting is
  kept, so the first upload turns it on by itself. Glass earns its blur in
  exactly two places — the stepper had none over a light page, so it uses
  accent tokens instead, and the showcase card's scrim, where text sits over a
  photograph nobody here has seen. **Per-service images were already in the
  schema and already rendered; no owner could set one** — `services-manager`
  now has the field and `media-upload` a `service` kind (ungated, like `staff`:
  a picture of what you sell is content, not branding).
- **Onboarding presets** (0026) — the wizard opens by asking the trade
  (מספרת גברים / ציפורניים ויופי / blank), and the services step opens with that
  set instead of three hardcoded barber rows. `lib/onboarding-presets.ts` is
  pure data with no imports **because a preset is defaults, not a mode** —
  nothing downstream branches on it. Stored as a column rather than a query
  param since step 0 runs before the business row exists and step 2 runs two
  navigations later; `?preset=` bridges that one hop, as `?plan=` does. Text
  not an enum, so retiring a preset needs no migration and an unknown value
  degrades to the default set. **Saved services always beat the preset**, or an
  owner returning to edit would lose their own three. Media pre-fill is
  structured but **empty on every preset, pinned by a test** — `demo-nails` has
  no assets and `demo-barber`'s live under its own tenant storage path, so
  wiring either would put one fabricated shop's premises on real booking pages.
- **Waitlist** (0024) — public join from the booking page, `/w/[token]` invite
  with a first-come screen, `/dashboard/waitlist` as the single management
  surface. A cancellation offers the slot to the **front of the queue
  automatically**, from both cancellation paths. No banner, nothing to approve.
- **Offer expiry** (0025) — an invite is now the invited client's for
  `waitlist_offer_ttl_min` (default 60, `0` disables, floor of 15). Past it the
  entry goes **`expired` — terminal, out of the queue** — and the slot is
  re-offered to the next match. That terminal status is not incidental:
  `entryMatchesSlot` accepts only `active`/`notified`, so it is the **only**
  thing stopping the sweep handing the slot straight back to whoever just let
  it lapse. The cost is deliberate and worth restating — **missing one message
  costs a client their place.** Two enforcement points, both needed:
  `offerDeadline` answers from the clock (page + claim action, correct on
  time), and `runWaitlistOfferExpirySweep` on the cron does the cycling
  (progress, up to a sweep interval late). The lapsed **token is deliberately
  kept** — clearing it makes `/w/[token]` a 404 instead of the "this expired"
  screen — and it is inert because the claim action refuses `expired`.
- **Availability** — dense packing (single chair) already offers the earliest
  genuinely free instant. Grid mode (teams) ceils to the lattice **on purpose**,
  to stop the interleaved `09:00 / 09:05` columns a shop reported; a rescue
  anchor reclaims a window only when the lattice cannot sell it at all. Offering
  the tight start *always* would reverse that fix — a real trade, one line away.
- **Demo seed** — deterministic per tenant so screenshots reproduce; starts snap
  to `slot_interval_min`; dense behind and half-empty ahead, so the E2E suite can
  still book against `demo-barber`. That describes what the seed *writes*, not
  what is in production — see the demo-tenant warning above, which is currently
  the opposite.

- **Landing page** — one canvas, not two panels. The hero's full-bleed violet
  block is gone; it forced everything over it to hardcode `text-white` and
  squeezed the only proof on the page into a column that vanished below `lg`.
  Now a hairline grid and one glow sit behind the product. **Its phones are
  drawn in code since 2026-09-19** (`mock-kit.tsx`, `mock-screens.tsx`): the
  screenshots — re-shot once at 2944×6400 to beat a resolution ceiling —
  showed a dashboard that no longer existed once it moved to liquid glass, a
  floating dock and ליבי. The drawn ones are built from the dashboard's own
  glass classes and `StatusChip`, scaled by redefining Tailwind's variables
  rather than a transform, so they stay sharp at any width and cannot go
  stale; see ARCHITECTURE, *The landing page's phones are drawn*.
  `public/screenshots/`, `lib/screenshots.ts` and its build-time check went
  with them — git history has the images. No static asset is needed.
  The two demo buttons are a **tinted wash with a matching border** — the 500 at
  10% over a 1px border at 45%, in the accent each tenant actually renders —
  with the shop's colour surviving at full strength in an 8px dot. They were
  solid 500 blocks, which shouted louder than the primary CTA above them.
  **The contrast argument moved rather than went away.** A saturated fill put
  the label on the fill (white on amber-500 is **2.15:1**), so the ink was
  near-black and needed no `dark:` variant. A 10% wash is within a hair of the
  page, so the label is measured against the *page* and the ink now follows the
  theme: `zinc-900` / `dark:zinc-50`, measured in-browser at **16.3:1** and
  **15.2:1** light, **15.8:1** and **16.8:1** dark — wider margins than the
  solid fill had. `demo-links.test.ts` guards the new mechanism, not the old
  one: the wash must keep its alpha, the ink must stay neutral and per-theme
  (an accent-coloured label on an accent wash is the natural edit and lands
  near 3:1), and the border must survive, because a 10% wash with no border is
  not visibly a control.

### Measured, so it is not re-audited

A production build at 390px under 4× CPU and ~1.6Mbps, 2026-09-03. **Measure
against `next start`, not `next dev`** — the dev server's unminified JS and HMR
client compete with real assets and roughly doubled the booking page's LCP.
`.claude/launch.json` carries a `bazman-prod` entry for exactly this.

| Route | CLS | LCP | Notes |
| --- | --- | --- | --- |
| `/` | **0** | 1.5s (hero `<img>`) | `preload` on the hero is working |
| `/[slug]` booking | **0** | 4.1s (`<video>`) | the banner clip *is* the LCP element |
| `/dashboard` (PWA `start_url`) | **0** | 2.1s (text) | 15 JS files, 19KB transferred |
| `/dashboard/agenda/full` | **0** | 2.1s (text) | 14 files, 15KB |

Already correct and **not worth changing again**: fonts (`next/font` Heebo,
`display: swap`, metric-matched fallback generated automatically); dark mode is
pure `@media (prefers-color-scheme)` with **no theme script**, so a startup
FOUC is not reachable; `viewportFit: "cover"` and per-scheme `themeColor` are
set; the manifest starts at `/dashboard` deliberately; and the service worker
caches nothing on purpose — see its own header before "fixing" that.

**The one real weight is the hero video.** `demo-barber` is 3MB at 720×1280,
drawn into a 390×293 box. On ~1.6Mbps the first frame paints at ~4s and
autoplay does not start for far longer, because `autoplay` waits for
`HAVE_ENOUGH_DATA` and at that bitrate that is most of the file. **No attribute
fixes this** — `preload="auto"` was tried and measured within noise (4.14s →
4.19s), so it was not kept. What would: a poster frame (needs a column and a
migration), or a smaller file. `MAX_VIDEO_BYTES` currently permits **25MB**,
eight times the demo, on the product's most-shared page.

**Stepping days and weeks, 2026-09-19**, production build at 390px against the
Seoul database: the old full navigation took **2.5–2.9s a day and 2.1–2.2s a
week**, date and bookings together behind a skeleton. In memory, the date
changes in **2–14ms**; the bookings arrive in **0.004–0.55s** when the owner
reads for a second and a half before stepping, and **1.5–1.85s** at worst, a
step tapped the instant the page loaded. A write from the calendar is drawn
before it is sent and nothing waits on its answer — a drop is final (forced,
with an undo) and a swap is planned in the browser, so the ~6–7s the server
still takes (nearly all of it round trips from here to Seoul) is felt only as
a spinner in the rail's corner. The region decision in §5 is what shortens
that; nothing in the page would.

### What it deliberately does not do

- **The client is never told an appointment moved.** No notification kind exists
  and adding one needs a Meta template. The move dialog says so in as many words.
- **A waitlist entry never expires by itself.** Somebody who joined in March is
  still matched in August. 0025 expires *offers*, not *entries* — a different
  clock (`created_at`, not `invited_at`) and still an open decision, because
  dropping somebody who is simply still waiting wants a warning first.
- **A move into the past is refused** — availability filters past instants, so
  correcting the recorded time of a finished booking needs its own path.
- **The service cannot be changed from the dialog.** `serviceName` and
  `priceCents` are snapshots so history survives edits to the catalogue.

### Broken in production right now

**Client email reaches nobody.** Resend rejects every recipient with a `403`
because the account has no verified domain, so it may only mail its own owner.
`/master/alerts` showed **7 failed sends**. `check:env` cannot catch it — the key
is present and valid — and from the owner's side the booking simply worked.
Verify a domain at resend.com → Domains and point `NOTIFICATIONS_FROM_EMAIL` at
it. See [DEPLOYMENT.md](DEPLOYMENT.md#2-environment-variables).

**And with it, sign-up.** Supabase Auth sends the confirmation mail itself
(DEPLOYMENT §b points its SMTP at the same Resend account), so an unverified
domain fails the send — and GoTrue rolls the account back, since it creates the
user and sends inside one transaction. The evidence, read off the database on
2026-09-20: **no `auth.users` row for the address that was tried, no trigger on
that table, three users in total and the newest from 18.8**. The form now says
so in Hebrew and the log carries GoTrue's own sentence; before 2026-09-20 both
said `{}` — see the trap below. **Nothing in the code fixes this**: verify the
domain, or point Supabase → Project Settings → Authentication → SMTP at a
provider that delivers, and try again.

### Blocked on a decision or an account, not on code

| What | Needs |
| --- | --- |
| Billing 8d–8e | A payment provider chosen. `getBillingProvider()` is the only function that learns the name. |
| SMS | A Twilio account, or drop the SMS line from Pro in `lib/plans.ts` — `check:env --production` fails either way until one happens. |
| ~~WhatsApp transport~~ | **Done.** Credentials are live and **real messages have been delivered** on Meta Cloud — 2 `booking_confirmation` sends in production as of 2026-08-23. This row was stale for weeks. |
| WhatsApp, the last two | **Seven of eight kinds now deliver.** All 8 registered templates are wired — see [WHATSAPP_TEMPLATES.md](WHATSAPP_TEMPLATES.md) §2. Outstanding: `client_winback` (**Marketing**, different rules) and `booking_rescheduled`, which needs a migration and a `renderNotification` case before a template is worth submitting. Two traps are pinned by tests: the `_he` suffix (the un-suffixed names hold the **English** originals and would deliver those), and three distinct button-suffix shapes — bare token, `b/<token>`, and the slug. |
| ~~Voice ("ליבי")~~ | **Done.** `OPENAI_API_KEY` is live and real Hebrew utterances have been transcribed, routed to the right tool and spoken back. Pro-gated. |
| ליבי's fast voice in production | `ELEVENLABS_MODEL_ID` in Vercel: set it to `eleven_v3_conversational` or delete it. The code's default is already the fast model, but a variable pinned to `eleven_v3` keeps every sentence ~1.8s slower. `.env.local` was switched on 2026-09-17. |
| Web push | Nothing — a VAPID trio is configured and `check:env` reports `push → live`. Unproven: no notification has reached a real device. |
| Media uploads | `npm run storage:setup` against the production project. |
| Legal text | An Israeli lawyer. `LEGAL_ENTITY` still holds placeholder ח.פ. and address fields. |

### Never verified in a browser

**Mostly cleared for the dashboard (2026-08-29).** The blocker was never the
browser, it was the session — and the repository already solved that:
`E2E_EMAIL` / `E2E_PASSWORD` in `.env.local` drive `signInAsOwner`, so a
Playwright script signs in the way the suite does and no password is ever typed
by hand. That is the mechanism to reuse; a fresh session should not go looking
for another one.

All ten dashboard routes were walked signed-in as `demo-barber`'s owner at
**390px and 1440px**. What that proved:

- **Zero horizontal overflow at 390px on every route** — measured as
  `scrollWidth - innerWidth`, not eyeballed, because a viewport screenshot is
  itself clipped and cannot show the overflow it is hiding.
- **Zero console errors** across the sweep.
- The **gradient header** on the management pages renders as intended — icon
  chip, title, subtitle, hairline rule.
- The **week calendar** is right where it is easiest to get wrong: RTL day
  order, time axis on the right, working-hours shading carrying the 13:00–14:00
  break, Friday closing at 13:00, and Saturday absent entirely.
- Empty states are the honest kind — analytics prints `0` for a real zero and
  an em-dash for "no data", which are different answers.

**Two false positives, recorded so the next pass does not re-find them.** Both
cost time here:

- A dark circular badge sits over the "לקוחות" item in the phone bottom bar. It
  is the **Next.js dev-mode indicator**, present only under `next dev`, not a
  product defect. It is at the identical position on every route, which is how
  to tell.
- The agenda toolbar appears **twice** in a `fullPage` screenshot, top and
  bottom. The DOM has exactly one — it is a capture artifact of `fullPage`
  against a sticky element. Confirm a duplicate by counting in the DOM before
  believing a full-page image.

**ליבי on an iPhone.** The microphone now stays open for a whole
conversation (2026-09-17). Chromium with a WAV file as the microphone
verified the loop, the noise handling, talking over her and the faster voice;
whether iOS Safari lowers her volume or routes it to the earpiece while a
capture is live needs a real device. Her glow and orb are plain CSS since
2026-09-22 (transform and opacity only), so they are not the risk on a phone
they were as a package.

**No longer blocked on data.** The calendar carrying real appointments and the
appointment dialog as a bottom sheet were parked here because both demo tenants
were empty. They are not — counted against production and recorded at the top
of §5 — so nothing external is in the way and these are one script away. The
calendar half has since been seen loaded twice: the overlap fix was measured on
the seeded week at 45 cards with zero spilling pairs, and **a fortnight at full
capacity** at 90 and 83 cards a week with zero — see *The calendar at
capacity*. **The dialog as a bottom sheet on a phone has now been seen** — at 390px in
both themes, while rebuilding it as glass — and the first look found ליבי's
microphone on top of it. See *Liquid glass* above.

The **landing page** is no longer in this bucket either: it has been checked in
the browser in both themes at 375px and desktop, with contrast measured in-page
rather than eyeballed.

---

**Definition of Done for MVP:** a business owner signs up, configures services and hours in under 10 minutes, shares `yourdomain.com/their-slug`, and a client books a real appointment from a phone — with both parties emailed and no double-booking possible. ✅ _Met — pending the production deploy and a pilot._
