import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  smallint,
  text,
  time,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

/**
 * All timestamps are stored in UTC (timestamptz) and rendered in
 * `businesses.timezone`. Wall-clock templates (working hours) are stored as
 * naive `time` values that are interpreted in the business timezone.
 */

export const appointmentStatus = pgEnum("appointment_status", [
  "pending",
  "confirmed",
  "cancelled",
  "completed",
  "no_show",
]);

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
]);

export const notificationStatus = pgEnum("notification_status", [
  "pending",
  "sent",
  "failed",
  "skipped",
]);

export const businesses = pgTable("businesses", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** FK to auth.users — Supabase owns that table, so it is not modelled here. */
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
});

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

/** One-off closures: vacations, holidays, mid-day breaks. */
export const timeOff = pgTable(
  "time_off",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    reason: text("reason"),
  },
  (t) => [index("time_off_business_range_idx").on(t.businessId, t.startsAt)],
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
  },
  (t) => [
    index("appointments_business_starts_idx").on(t.businessId, t.startsAt),
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
}));

export type Business = typeof businesses.$inferSelect;
export type NewBusiness = typeof businesses.$inferInsert;
export type Service = typeof services.$inferSelect;
export type NewService = typeof services.$inferInsert;
export type WorkingHour = typeof workingHours.$inferSelect;
export type NewWorkingHour = typeof workingHours.$inferInsert;
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
