import type { NotificationChannel, NotificationKind } from "@/db/schema";

export type { NotificationChannel, NotificationKind };

export type OutboundMessage = {
  channel: NotificationChannel;
  recipient: string;
  /** Email only; ignored by SMS/WhatsApp. */
  subject?: string;
  body: string;
  /**
   * The Meta-approved WhatsApp template for this message, when one exists.
   *
   * Carried **beside** `body` rather than replacing it, because the two
   * backends need different things: the official Business API (Twilio) must
   * send the template or Meta drops the message, while Green API drives the
   * shop's own account and sends the rendered Hebrew text. One field each
   * means neither backend has to reconstruct the other's payload.
   *
   * Absent for email, SMS, and for WhatsApp kinds with no approved template.
   */
  template?: WhatsAppTemplateRef;
};

/**
 * One approved WhatsApp template, in Meta's component shape.
 *
 * **Every component is numbered from 1 independently.** That is not a detail —
 * it is why `appointment_confirmation` has two `{{1}}`: one in its header and
 * one in its body, filled from different values. A single flat array cannot
 * express that, which is what this type replaced.
 *
 * Twilio, by contrast, flattens a Content Template into one namespace. That
 * difference lives in the Twilio adapter rather than here, because the shape
 * Meta approved is the one this repository has to be true to.
 */
export type WhatsAppTemplateRef = {
  name: string;
  language: string;
  /**
   * `header` component text parameters. Absent when the approved copy has no
   * header at all — which is the case for both reminders.
   */
  header?: string[];
  /** `body` component parameters — index 0 fills body `{{1}}`. */
  parameters: string[];
  /**
   * Appended to the *static base* of the approved URL button.
   *
   * Meta stores the base (`https://www.bazman.app/`) at approval time and takes
   * only the varying tail, so this is a bare cancel token and never a whole
   * URL. Sending the full `manageUrl` here would render
   * `https://www.bazman.app/https://www.bazman.app/b/…`.
   *
   * Absent when the template has no button — `reminder_2h` is sent two hours
   * out with nothing to press.
   */
  buttonUrlSuffix?: string;
};

export type SendResult =
  | { ok: true; providerId?: string }
  | { ok: false; error: string; retryable: boolean };

export type NotificationProvider = {
  /** Shown in logs and the dashboard so it is obvious what actually sent. */
  name: string;
  channel: NotificationChannel;
  send(message: OutboundMessage): Promise<SendResult>;
};

/**
 * Kinds that address the *platform's* relationship with the tenant rather than
 * a booking. They carry no appointment, which is exactly why the dispatcher
 * needed an appointment-optional path: it used to skip any row without one, so
 * these would have inserted cleanly and then disappeared.
 */
export const BILLING_KINDS = [
  "trial_ending",
  "trial_ended",
  "payment_failed",
  "payment_receipt",
] as const;

export type BillingKind = (typeof BILLING_KINDS)[number];
export type AppointmentKind = Exclude<NotificationKind, BillingKind>;

export function isBillingKind(kind: NotificationKind): kind is BillingKind {
  return (BILLING_KINDS as readonly string[]).includes(kind);
}

/** Everything an appointment template needs, resolved once at dispatch time. */
export type AppointmentContext = {
  kind: AppointmentKind;
  businessName: string;
  businessPhone: string | null;
  businessAddress: string | null;
  businessTimezone: string;
  bookingUrl: string;
  manageUrl: string;
  /**
   * The bare cancel token behind `manageUrl`.
   *
   * Carried beside the URL rather than parsed back out of it: Meta's URL button
   * takes only the tail after an approved static base, so the token is a value
   * this layer needs in its own right, and recovering it with a regex over a
   * string this module also builds would be a second source of truth.
   */
  manageToken: string;
  clientName: string;
  serviceName: string;
  priceCents: number;
  startsAt: string;
  /**
   * The appointment's status *at dispatch time*, which is what lets the owner
   * alert distinguish a booking from a request awaiting them.
   *
   * Only useful for kinds that can occur in more than one state. It cannot
   * distinguish a rejection from a cancellation — both read `cancelled` by the
   * time the row is sent — which is why those are separate kinds.
   */
  status: string;
};

/**
 * Billing templates address the owner, not a client. A separate shape rather
 * than optional fields on the one above: making `clientName` optional would
 * make it optional for the reminder template too, where its absence is a bug.
 */
export type BillingContext = {
  kind: BillingKind;
  businessName: string;
  businessTimezone: string;
  /** Where the owner goes to fix it. */
  billingUrl: string;
  /** Display name of the tier involved, e.g. "מקצועי". */
  planName: string;
  /** Trial end or grace end, whichever the kind is about. ISO. */
  deadline?: string;
  /** Days remaining, for the warning copy. */
  daysLeft?: number;
  /** Charged or attempted amount, in agorot. */
  amountCents?: number;
};

export type NotificationContext = AppointmentContext | BillingContext;
