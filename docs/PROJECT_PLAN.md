# PROJECT PLAN — Appointment Scheduling SaaS

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

| Layer | Choice | Why |
|---|---|---|
| Framework | **Next.js 15+ (App Router)** — RSC + Server Actions | SSR public pages, one codebase for API + UI |
| Language | **TypeScript** (strict) | Type safety end-to-end |
| Styling | **Tailwind CSS v4** + shadcn/ui + Radix | Fast, consistent, RTL via logical properties |
| DB | **PostgreSQL (Supabase)** | Managed, pooled, backups, generous free tier |
| ORM | **Drizzle ORM** + drizzle-kit migrations | Fast, edge-friendly, SQL-first, zero runtime bloat *(Prisma is the acceptable alternative if the team prefers its DX)* |
| Auth | **Supabase Auth** (magic link / OTP) — owners only | Clients book without accounts |
| Validation | **Zod** (shared client/server schemas) | Single source of truth for forms + API |
| Dates | **date-fns** + `date-fns-tz` | Timezone-correct slot math |
| Forms | React Hook Form + Zod resolver | Minimal re-renders |
| State/Data | Server Components + Server Actions; TanStack Query only where needed | Less client JS |
| Files | Supabase Storage | Logos, service & gallery images |
| Email | Resend + React Email | Confirmations & reminders |
| Jobs/Cron | Vercel Cron (or Supabase pg_cron) | Reminder dispatch |
| Hosting | Vercel | Edge CDN, preview deploys |
| Quality | ESLint + Prettier, Vitest (slot logic), Playwright (booking flow) | Guard the critical path |
| Observability | Sentry + Vercel Analytics | Errors + funnel drop-off |

**Key conventions**
- Store all timestamps in **UTC**; render in `business.timezone`.
- Multi-tenancy by `business_id` on every row; enforce with RLS + app-layer scoping.
- Slot generation is **server-side only** — never trust client-computed availability.

---

## 3. Database Schema (concise)

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

---

## 4. Development Roadmap

### Phase 0 — Foundation
- [ ] `create-next-app` (TS, App Router, Tailwind), ESLint/Prettier, strict `tsconfig`.
- [ ] Supabase project; connection strings in `.env.local` + `.env.example`.
- [ ] Drizzle schema + first migration; seed script (1 demo business, 3 services, working hours).
- [ ] Base layout: RTL support, fonts, shadcn/ui init, theme tokens.

### Phase 1 — Data & Availability Engine (the core)
- [ ] Repository/query layer scoped by `business_id`.
- [ ] `getAvailableSlots({ businessId, serviceId, date })`: working hours → subtract booked + time_off → apply buffer, min notice, max advance → return slot list.
- [ ] Unit tests: DST boundary, split shifts, back-to-back bookings, closed days, buffer edges.
- [ ] Add overlap exclusion constraint + booking transaction that fails cleanly on conflict.

### Phase 2 — Public Booking Page
- [ ] `/[business_slug]` route: fetch business + active services (404 on unknown/inactive slug).
- [ ] Step 1 — service list UI (image, duration, price).
- [ ] Step 2 — date picker + slot grid (server-fetched availability, loading/empty states).
- [ ] Step 3 — details form (Zod + RHF) → Server Action `createAppointment` (re-validates slot server-side).
- [ ] Confirmation screen + `.ics` download.
- [ ] `/b/[cancel_token]` — view, cancel, reschedule within the cancellation window.
- [ ] Mobile polish, RTL pass, SEO/OG tags per business.

### Phase 3 — Admin Dashboard
- [ ] Supabase Auth magic link; middleware guard; `/dashboard` shell + business resolution from session.
- [ ] Appointments: day/week view, filters, manual create/edit/cancel, mark completed/no-show.
- [ ] Services CRUD + image upload to Supabase Storage.
- [ ] Working hours editor (weekday rows, split shifts, closed toggle).
- [ ] Time off manager.
- [ ] Settings page (slug uniqueness check, timezone, booking rules, logo).
- [ ] Clients list from appointment history.

### Phase 4 — Notifications
- [ ] Email adapter (Resend) + React Email templates: client confirmation, owner alert, cancellation.
- [ ] `/api/cron/reminders` — hourly job, sends T-24h reminders, sets `reminder_sent_at` (idempotent).
- [ ] Notification interface ready for a WhatsApp/SMS provider.

### Phase 5 — Onboarding & Multi-tenant Polish
- [ ] Sign-up flow: create business → pick slug → services → working hours → live link.
- [ ] Enable RLS policies on all tables; verify cross-tenant isolation with tests.
- [ ] Dashboard stats cards (today / week / cancellations / no-shows).
- [ ] Basic marketing landing page at `/`.

### Phase 6 — Ship
- [ ] Playwright E2E: full booking flow + cancel flow + admin CRUD.
- [ ] Sentry, rate limiting on booking endpoint, honeypot/anti-spam on the public form.
- [ ] Production deploy to Vercel, custom domain, DB backups verified.
- [ ] Pilot with 1–2 real businesses; collect feedback before building payments/staff/WhatsApp.

---

**Definition of Done for MVP:** a business owner signs up, configures services and hours in under 10 minutes, shares `yourdomain.com/their-slug`, and a client books a real appointment from a phone — with both parties emailed and no double-booking possible.
