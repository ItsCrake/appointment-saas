import type { NotificationChannel, NotificationKind } from "@/db/schema";

export type { NotificationChannel, NotificationKind };

export type OutboundMessage = {
  channel: NotificationChannel;
  recipient: string;
  /** Email only; ignored by SMS/WhatsApp. */
  subject?: string;
  body: string;
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

/** Everything a template needs, resolved once at dispatch time. */
export type NotificationContext = {
  kind: NotificationKind;
  businessName: string;
  businessPhone: string | null;
  businessAddress: string | null;
  businessTimezone: string;
  bookingUrl: string;
  manageUrl: string;
  clientName: string;
  serviceName: string;
  priceCents: number;
  startsAt: string;
};
