import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  smallint,
  text,
  time,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

/**
 * All timestamps are stored in UTC (timestamptz) and rendered in
 * `businesses.timezone`. Wall-clock templates (working hours) are stored as
 * naive `time` values that are interpreted in the business timezone.
 */

/**
 * `pending_deposit` and `pending_approval` (0014) exist for the deposit flow,
 * which is **not enabled anywhere in the UI**. Nothing writes them yet.
 *
 * Both are non-terminal, so the double-booking guard holds their slots without
 * naming them: 0013 states the predicate as "not one of the terminal statuses"
 * rather than listing the ones that hold. See `0014_deposit_infrastructure.sql`
 * for why it could not have been written the other way round.
 */
export const appointmentStatus = pgEnum("appointment_status", [
  "pending",
  "confirmed",
  "cancelled",
  "completed",
  "no_show",
  "pending_deposit",
  "pending_approval",
]);

/** The statuses that release a slot. Mirrors the exclusion predicate in 0013. */
export const TERMINAL_STATUSES = ["cancelled", "completed", "no_show"] as const;

export const notificationChannel = pgEnum("notification_channel", [
  "email",
  "sms",
  "whatsapp",
]);

export const notificationKind = pgEnum("notification_kind", [
  "booking_confirmation",
  "booking_alert",
  "cancellation_confirmation",
  "cancellation_alert",
  "reminder",
  // Billing kinds (0012). These carry no appointment, which is why the
  // dispatcher grew an appointment-optional path — it used to skip any row
  // without one, so these would have inserted cleanly and then vanished.
  "trial_ending",
  "trial_ended",
  "payment_failed",
  "payment_receipt",
]);

export const notificationStatus = pgEnum("notification_status", [
  "pending",
  "sent",
  "failed",
  "skipped",
]);

export const businesses = pgTable("businesses", {
  id: uuid("id").primaryKey().defaultRandom(),
  /**
   * FK to `auth.users` with ON DELETE CASCADE, declared in migration 0008.
   * Supabase owns that table and it is not modelled here, so — like the
   * exclusion constraint and the RLS policies — the constraint lives in SQL
   * rather than in this file. Deleting an owner account therefore erases the
   * business and everything under it.
   */
  ownerUserId: uuid("owner_user_id").notNull(),
  /** Public booking page lives at /[slug]. */
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  logoUrl: text("logo_url"),
  phone: text("phone"),
  address: text("address"),
  timezone: text("timezone").notNull().default("Asia/Jerusalem"),
  locale: text("locale").notNull().default("he"),
  /** Granularity of offered start times, in minutes. */
  slotIntervalMin: integer("slot_interval_min").notNull().default(15),
  /** Gap enforced after each appointment, in minutes. */
  bufferMin: integer("buffer_min").notNull().default(0),
  /** Earliest bookable offset from now, in minutes. */
  minNoticeMin: integer("min_notice_min").notNull().default(60),
  /** Booking horizon, in days. */
  maxAdvanceDays: integer("max_advance_days").notNull().default(60),
  /** Clients may self-cancel until this many hours before the start. */
  cancelWindowHours: integer("cancel_window_hours").notNull().default(24),
  /** Hours before the appointment to send the client reminder. 0 disables. */
  reminderHoursBefore: integer("reminder_hours_before").notNull().default(24),
  /** Where owner alerts go. NULL means the owner gets no notifications. */
  notificationEmail: text("notification_email"),
  /**
   * Set on the onboarding finish screen. NULL means the owner still has steps
   * to complete; explicit state rather than inferring from service count,
   * which would drag an owner back into setup after deleting a service.
   */
  onboardingCompletedAt: timestamp("onboarding_completed_at", {
    withTimezone: true,
  }),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),

  /* ---- Branding. Presentation only: none of it reaches the booking rules. -- */

  /**
   * Accent swatch for the public page. A plain varchar rather than a pgEnum:
   * adding a colour is a stylesheet change, and an enum would force a
   * migration and a deploy to ship one. `lib/branding.ts` validates on read,
   * so an unknown value renders the default instead of breaking the page.
   */
  themeColor: varchar("theme_color", { length: 20 })
    .notNull()
    .default("indigo"),
  /** Optional hero background behind the business name. */
  heroMediaUrl: text("hero_media_url"),
  /** "image" | "video". NULL whenever there is no hero. */
  heroMediaType: varchar("hero_media_type", { length: 10 }),
  /**
   * Image URLs, ordered — the array position *is* the display order, which is
   * why this is jsonb rather than a child table with a sort column.
   */
  galleryUrls: jsonb("gallery_urls").$type<string[]>().notNull().default([]),
  /**
   * Owner-entered testimonials. Deliberately not a table: they are typed in by
   * hand, never queried across tenants, and have no lifecycle of their own.
   * Shape is enforced by `reviewsSchema` on write and re-checked on read.
   */
  reviews: jsonb("reviews")
    .$type<
      {
        id: string;
        clientName: string;
        rating: number;
        comment: string;
        date: string;
      }[]
    >()
    .notNull()
    .default([]),

  /* ---- Subscription. Recorded, not enforced — see the note below. --------- */

  /**
   * The tier the owner picked during onboarding. **Nothing bills against this
   * and no feature is gated on it**: there is no payment provider wired up, so
   * this records a stated intent, not an entitlement. Treat it as a lead
   * signal until checkout exists.
   */
  planType: varchar("plan_type", { length: 20 }).notNull().default("starter"),
  /**
   * Always `trialing` today, for the same reason. Kept as a column rather than
   * derived so the eventual billing integration has somewhere to write.
   */
  subscriptionStatus: varchar("subscription_status", { length: 20 })
    .notNull()
    .default("trialing"),
  /**
   * When the trial lapses. NULL means no trial clock is running — an account
   * that was converted, cancelled, or created before trials were tracked.
   *
   * Since 0012 this **is** enforced: the daily sweep moves a lapsed trial to
   * `past_due` and starts the grace clock below.
   */
  trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),

  /* ---- Billing lifecycle (0012). --------------------------------------- */

  /**
   * When the non-payment grace window started. NULL means no clock is running.
   *
   * Explicit rather than derived from `trialEndsAt`, because the other route
   * into grace is a failed payment on an active subscription, which has no
   * trial behind it.
   */
  graceStartedAt: timestamp("grace_started_at", { withTimezone: true }),
  /**
   * `admin` | `billing`. NULL whenever `isActive` is true.
   *
   * The sweep only ever unfreezes `billing`. Without this column a tenant an
   * admin froze deliberately would be reinstated by their next payment.
   */
  frozenReason: varchar("frozen_reason", { length: 20 }),
  /** `monthly` | `yearly`. What the subscription is billed on. */
  billingCycle: varchar("billing_cycle", { length: 10 })
    .notNull()
    .default("monthly"),
  /** Opaque provider handles. Never parsed by the app. */
  providerCustomerId: text("provider_customer_id"),
  providerSubscriptionId: text("provider_subscription_id"),
  /** End of the paid period, as reported by the provider. */
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  /** Set when an owner cancels but has already paid through the period. */
  cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),

  /* ---- Multi-staff (0013). ---------------------------------------------- */

  /**
   * The answer to the one question setup asks: "האם יש יותר מנותן שירות אחד
   * בעסק?". False hides staff selection everywhere — dashboard and booking
   * flow both — and the tenant's single backfilled staff row takes every
   * appointment silently.
   *
   * An explicit column rather than `count(staff) > 1`, because an owner has to
   * be able to answer *yes* before adding anyone, and to collapse back to a
   * single provider without deleting people who hold history.
   */
  hasMultipleStaff: boolean("has_multiple_staff").notNull().default(false),

  /* ---- Deposits (0014). Schema only — no UI reads any of this. ---------- */

  depositEnabled: boolean("deposit_enabled").notNull().default(false),
  /** `manual` (Bit / PayBox, confirmed by eye) | `gateway`. */
  depositMode: varchar("deposit_mode", { length: 20 })
    .notNull()
    .default("manual"),
  /**
   * A flat sum in agorot, never a percentage. The manual flow asks a human to
   * transfer a specific number through Bit, and "30% of ₪180" is not a number
   * people type correctly.
   */
  depositAmountCents: integer("deposit_amount_cents").notNull().default(0),
  /** Where a Bit transfer goes. */
  depositBitPhone: text("deposit_bit_phone"),
  /** PayBox, or anything else that publishes a payment URL. */
  depositPaymentUrl: text("deposit_payment_url"),
  depositInstructions: text("deposit_instructions"),
  /** Opaque gateway handles, never parsed — same posture as the billing side. */
  depositProvider: text("deposit_provider"),
  depositProviderAccountId: text("deposit_provider_account_id"),

  /* ---- Social profiles (0015). ------------------------------------------ */

  socialInstagram: text("social_instagram"),
  socialFacebook: text("social_facebook"),
  socialTiktok: text("social_tiktok"),
  /** A phone number, not a URL — `lib/social-links.ts` builds the wa.me link. */
  socialWhatsapp: text("social_whatsapp"),
  websiteUrl: text("website_url"),
});

/**
 * Provider webhook log. `UNIQUE (provider, provider_event_id)` is the same
 * idempotency trick as `notifications.dedupe_key`: providers retry webhooks,
 * and a duplicate `invoice.paid` must not extend a paid period twice.
 *
 * RLS is on with **zero policies**, like `rate_limits`. Raw provider payloads
 * can carry billing addresses and card metadata, and an owner has no reason to
 * read the webhook stream at all.
 */
export const subscriptionEvents = pgTable(
  "subscription_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Nullable: an event that cannot be mapped to a tenant is still logged. */
    businessId: uuid("business_id").references(() => businesses.id, {
      onDelete: "set null",
    }),
    provider: text("provider").notNull(),
    providerEventId: text("provider_event_id").notNull(),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    /** `received` | `processed` | `ignored` | `failed`. */
    status: varchar("status", { length: 20 }).notNull().default("received"),
    error: text("error"),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (t) => [
    unique("subscription_events_provider_event_key").on(
      t.provider,
      t.providerEventId,
    ),
    index("subscription_events_business_idx").on(t.businessId, t.receivedAt),
  ],
);

/**
 * Billing history for the owner dashboard.
 *
 * RLS grants `SELECT` only, unlike every other tenant table. Owners genuinely
 * edit their services and hours; nobody edits their own invoices, and an owner
 * who could INSERT one could mark themselves paid.
 */
export const invoices = pgTable(
  "invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    providerInvoiceId: text("provider_invoice_id"),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull().default("ILS"),
    /** `draft` | `open` | `paid` | `void` | `uncollectible`. */
    status: varchar("status", { length: 20 }).notNull().default("open"),
    periodStart: timestamp("period_start", { withTimezone: true }),
    periodEnd: timestamp("period_end", { withTimezone: true }),
    issuedAt: timestamp("issued_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    /**
     * The provider's own document. For the Israeli market this is where the
     * חשבונית מס lives — the app does not generate tax documents itself.
     */
    hostedUrl: text("hosted_url"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("invoices_business_idx").on(t.businessId, t.issuedAt)],
);

export const services = pgTable(
  "services",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    durationMin: integer("duration_min").notNull(),
    /** Per-service gap override. NULL inherits `businesses.buffer_min`. */
    bufferMin: integer("buffer_min"),
    priceCents: integer("price_cents").notNull(),
    currency: text("currency").notNull().default("ILS"),
    imageUrl: text("image_url"),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("services_business_active_idx").on(t.businessId, t.isActive)],
);

/**
 * Service providers. Every business has at least one — created with the
 * business, and backfilled for existing tenants by 0013 — so `staff_id` on an
 * appointment is never null and the exclusion constraint always has something
 * to key on.
 *
 * A tenant that answers "no" to `hasMultipleStaff` keeps exactly this one row
 * and never sees the concept again: the booking flow skips the picker and the
 * dashboard hides the manager. The row still exists, which is what lets that
 * answer be changed later without a data migration.
 */
export const staff = pgTable(
  "staff",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Optional, e.g. "ספר בכיר". */
    title: text("title"),
    /**
     * Contact for the owner's own use (0017). Not a login, and nothing
     * dispatches to it — the notification outbox addresses clients, not staff.
     */
    phone: text("phone"),
    /**
     * Calendar swatch *name*, never a hex value — Tailwind cannot build a class
     * from a runtime value. `lib/staff-colors.ts` is the source of truth for
     * which names are legal; the stylesheet decides what they look like.
     */
    color: varchar("color", { length: 20 }).notNull().default("slate"),
    sortOrder: integer("sort_order").notNull().default(0),
    /**
     * Deactivate rather than delete. The FK from appointments is RESTRICT, so
     * anyone who has ever taken a booking cannot be removed at all — their
     * history is the reason.
     */
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("staff_business_active_idx").on(t.businessId, t.isActive)],
);

/**
 * Per-staff weekly hours.
 *
 * **No rows means "inherit the business hours"**, and that default is what
 * keeps the feature free for a shop that does not need it: a single-staff
 * tenant never fills this in, and 0013's backfill did not have to generate a
 * row per weekday per tenant to be correct.
 *
 * No `business_id` of its own — scoped through `staff`, so a schedule cannot be
 * separated from the person it belongs to.
 */
export const staffSchedules = pgTable(
  "staff_schedules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    staffId: uuid("staff_id")
      .notNull()
      .references(() => staff.id, { onDelete: "cascade" }),
    /** 0 = Sunday .. 6 = Saturday. */
    weekday: smallint("weekday").notNull(),
    startTime: time("start_time").notNull(),
    endTime: time("end_time").notNull(),
  },
  (t) => [
    unique("staff_schedules_staff_weekday_start_key").on(
      t.staffId,
      t.weekday,
      t.startTime,
    ),
    index("staff_schedules_staff_weekday_idx").on(t.staffId, t.weekday),
  ],
);

/** Weekly recurring template. Multiple rows per weekday = split shifts. */
export const workingHours = pgTable(
  "working_hours",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    /** 0 = Sunday .. 6 = Saturday. */
    weekday: smallint("weekday").notNull(),
    /** Local wall-clock time in the business timezone. */
    startTime: time("start_time").notNull(),
    endTime: time("end_time").notNull(),
    isClosed: boolean("is_closed").notNull().default(false),
  },
  (t) => [
    unique("working_hours_business_weekday_start_key").on(
      t.businessId,
      t.weekday,
      t.startTime,
    ),
    index("working_hours_business_weekday_idx").on(t.businessId, t.weekday),
  ],
);

/**
 * One-off closures: vacations, holidays, mid-day breaks.
 *
 * `staffId` NULL means the **whole shop** is closed — a holiday, a renovation.
 * Set, it is one person's absence and everyone else keeps taking bookings.
 * NULL is the original meaning, so every row that predates `0016` stayed
 * correct without a backfill.
 *
 * The FK to staff is composite, `(business_id, staff_id)`, declared in SQL
 * because Drizzle models single-column references. A plain `staff.id`
 * reference would accept one tenant's staff member on another tenant's
 * closure — both rows exist, so nothing would object — and availability would
 * quietly apply the wrong shop's absence.
 */
export const timeOff = pgTable(
  "time_off",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    /** NULL = the whole business. See the note above. */
    staffId: uuid("staff_id"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    reason: text("reason"),
  },
  (t) => [
    index("time_off_business_range_idx").on(t.businessId, t.startsAt),
    index("time_off_staff_idx").on(t.staffId, t.startsAt),
  ],
);

export const appointments = pgTable(
  "appointments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    /** Restricted: a service with history cannot be hard-deleted. */
    serviceId: uuid("service_id")
      .notNull()
      .references(() => services.id, { onDelete: "restrict" }),
    /**
     * Who is taking this appointment (0013). Never null: every business has at
     * least one staff row, and the exclusion constraint keys on this column —
     * a null would silently opt a row out of the double-booking guard.
     */
    staffId: uuid("staff_id")
      .notNull()
      .references(() => staff.id, { onDelete: "restrict" }),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    /** Derived from the service duration at booking time. */
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    status: appointmentStatus("status").notNull().default("confirmed"),
    clientName: text("client_name").notNull(),
    clientPhone: text("client_phone").notNull(),
    clientEmail: text("client_email"),
    notes: text("notes"),
    /** Snapshots — history must survive later edits to the service. */
    serviceName: text("service_name").notNull(),
    priceCents: integer("price_cents").notNull(),
    /** Powers the self-service cancel/reschedule link at /b/[token]. */
    cancelToken: text("cancel_token").notNull().unique(),
    reminderSentAt: timestamp("reminder_sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),

    /* ---- Deposits (0014). Not enabled anywhere in the UI. -------------- */

    /** Snapshot, like `priceCents`: this booking's terms must not move. */
    depositAmountCents: integer("deposit_amount_cents").notNull().default(0),
    /** When the *client* claimed to have transferred it. A claim, not a payment. */
    depositClaimedAt: timestamp("deposit_claimed_at", { withTimezone: true }),
    /** When the owner, or a gateway webhook, confirmed it. */
    depositConfirmedAt: timestamp("deposit_confirmed_at", {
      withTimezone: true,
    }),
    /** Gateway transaction id, or whatever the client offered as proof. */
    depositReference: text("deposit_reference"),
  },
  (t) => [
    index("appointments_business_starts_idx").on(t.businessId, t.startsAt),
    index("appointments_staff_starts_idx").on(t.staffId, t.startsAt),
    index("appointments_reminder_idx").on(t.startsAt, t.reminderSentAt),
  ],
);

/**
 * Transactional outbox. Sends are recorded here first and dispatched by the
 * cron job, so a provider outage never loses a message and a retry never
 * duplicates one (`dedupe_key` is unique).
 */
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    appointmentId: uuid("appointment_id").references(() => appointments.id, {
      onDelete: "cascade",
    }),
    channel: notificationChannel("channel").notNull(),
    kind: notificationKind("kind").notNull(),
    /** Email address or phone number, resolved when the row is enqueued. */
    recipient: text("recipient").notNull(),
    /** Earliest send time. Immediate messages use `now()`. */
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull(),
    status: notificationStatus("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    /** Idempotency key, e.g. "reminder:<appointmentId>:24". */
    dedupeKey: text("dedupe_key").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // The dispatcher's only hot query: pending rows that are due.
    index("notifications_due_idx").on(t.status, t.scheduledFor),
    index("notifications_business_idx").on(t.businessId, t.createdAt),
  ],
);

/**
 * Fixed-window counters. Postgres rather than Redis: no extra infrastructure,
 * and it works across serverless instances — an in-memory map would reset on
 * every cold start and give only the appearance of protection.
 *
 * The window bucket is baked into `key`, so each window is its own row and a
 * single upsert both increments and reports the current count.
 */
export const rateLimits = pgTable(
  "rate_limits",
  {
    /** "<scope>:<identifier>:<windowStartEpochMs>" */
    key: text("key").primaryKey(),
    count: integer("count").notNull().default(0),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    /** Pruned by the notifications cron; nothing here is worth keeping. */
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("rate_limits_expires_idx").on(t.expiresAt)],
);

export type RateLimitRow = typeof rateLimits.$inferSelect;

export const notificationsRelations = relations(notifications, ({ one }) => ({
  business: one(businesses, {
    fields: [notifications.businessId],
    references: [businesses.id],
  }),
  appointment: one(appointments, {
    fields: [notifications.appointmentId],
    references: [appointments.id],
  }),
}));

export const businessesRelations = relations(businesses, ({ many }) => ({
  services: many(services),
  workingHours: many(workingHours),
  timeOff: many(timeOff),
  appointments: many(appointments),
  staff: many(staff),
}));

export const staffRelations = relations(staff, ({ one, many }) => ({
  business: one(businesses, {
    fields: [staff.businessId],
    references: [businesses.id],
  }),
  schedules: many(staffSchedules),
  appointments: many(appointments),
}));

export const staffSchedulesRelations = relations(staffSchedules, ({ one }) => ({
  staff: one(staff, {
    fields: [staffSchedules.staffId],
    references: [staff.id],
  }),
}));

export const servicesRelations = relations(services, ({ one, many }) => ({
  business: one(businesses, {
    fields: [services.businessId],
    references: [businesses.id],
  }),
  appointments: many(appointments),
}));

export const workingHoursRelations = relations(workingHours, ({ one }) => ({
  business: one(businesses, {
    fields: [workingHours.businessId],
    references: [businesses.id],
  }),
}));

export const timeOffRelations = relations(timeOff, ({ one }) => ({
  business: one(businesses, {
    fields: [timeOff.businessId],
    references: [businesses.id],
  }),
  staff: one(staff, {
    fields: [timeOff.staffId],
    references: [staff.id],
  }),
}));

export const appointmentsRelations = relations(appointments, ({ one }) => ({
  business: one(businesses, {
    fields: [appointments.businessId],
    references: [businesses.id],
  }),
  service: one(services, {
    fields: [appointments.serviceId],
    references: [services.id],
  }),
  staff: one(staff, {
    fields: [appointments.staffId],
    references: [staff.id],
  }),
}));

export type Business = typeof businesses.$inferSelect;
export type NewBusiness = typeof businesses.$inferInsert;
export type Service = typeof services.$inferSelect;
export type NewService = typeof services.$inferInsert;
export type WorkingHour = typeof workingHours.$inferSelect;
export type NewWorkingHour = typeof workingHours.$inferInsert;
export type Staff = typeof staff.$inferSelect;
export type NewStaff = typeof staff.$inferInsert;
export type StaffSchedule = typeof staffSchedules.$inferSelect;
export type NewStaffSchedule = typeof staffSchedules.$inferInsert;
export type TimeOff = typeof timeOff.$inferSelect;
export type NewTimeOff = typeof timeOff.$inferInsert;
export type Appointment = typeof appointments.$inferSelect;
export type NewAppointment = typeof appointments.$inferInsert;
export type AppointmentStatus = (typeof appointmentStatus.enumValues)[number];
export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;
export type NotificationChannel =
  (typeof notificationChannel.enumValues)[number];
export type NotificationKind = (typeof notificationKind.enumValues)[number];
export type NotificationStatus = (typeof notificationStatus.enumValues)[number];
export type SubscriptionEvent = typeof subscriptionEvents.$inferSelect;
export type NewSubscriptionEvent = typeof subscriptionEvents.$inferInsert;
export type Invoice = typeof invoices.$inferSelect;
export type NewInvoice = typeof invoices.$inferInsert;
