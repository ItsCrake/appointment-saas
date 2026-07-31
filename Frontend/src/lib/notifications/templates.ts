import { formatFullDateTime, formatPrice } from "@/lib/format";

import type { NotificationContext } from "./types";

/**
 * Hebrew copy for every notification kind. Kept as plain strings so the same
 * template serves email, SMS and WhatsApp: SMS simply drops the subject, and
 * the email provider wraps the body in minimal HTML. Add a `channel` argument
 * here if the copy ever needs to differ per channel.
 */
export function renderNotification(context: NotificationContext): {
  subject: string;
  body: string;
} {
  const when = formatFullDateTime(context.startsAt, context.businessTimezone);
  const slot = `יום ${when.weekday}, ${when.date} בשעה ${when.time}`;
  const price = formatPrice(context.priceCents);
  const contact = context.businessPhone
    ? `\nלשאלות: ${context.businessPhone}`
    : "";
  const where = context.businessAddress
    ? `\nכתובת: ${context.businessAddress}`
    : "";

  switch (context.kind) {
    case "booking_confirmation":
      return {
        subject: `התור שלך ב${context.businessName} נקבע`,
        body:
          `היי ${context.clientName},\n\n` +
          `התור שלך ב${context.businessName} נקבע בהצלחה.\n\n` +
          `${context.serviceName} · ${price}\n${slot}${where}\n\n` +
          `לצפייה או ביטול: ${context.manageUrl}${contact}`,
      };

    case "reminder":
      return {
        subject: `תזכורת: התור שלך ב${context.businessName}`,
        body:
          `היי ${context.clientName},\n\n` +
          `תזכורת לתור שלך ב${context.businessName}.\n\n` +
          `${context.serviceName}\n${slot}${where}\n\n` +
          `לביטול: ${context.manageUrl}${contact}`,
      };

    case "cancellation_confirmation":
      return {
        subject: `התור שלך ב${context.businessName} בוטל`,
        body:
          `היי ${context.clientName},\n\n` +
          `התור שלך ב${context.businessName} ל${slot} בוטל.\n\n` +
          `לקביעת תור חדש: ${context.bookingUrl}${contact}`,
      };

    case "booking_alert":
      return {
        subject: `תור חדש: ${context.clientName} — ${slot}`,
        body:
          `נקבע תור חדש ב${context.businessName}.\n\n` +
          `לקוח: ${context.clientName}\n` +
          `שירות: ${context.serviceName} · ${price}\n` +
          `מועד: ${slot}`,
      };

    case "cancellation_alert":
      return {
        subject: `בוטל תור: ${context.clientName} — ${slot}`,
        body:
          `תור בוטל ב${context.businessName}.\n\n` +
          `לקוח: ${context.clientName}\n` +
          `שירות: ${context.serviceName}\n` +
          `מועד שהתפנה: ${slot}`,
      };
  }

  // Exhaustive above; this satisfies the compiler for unknown future kinds.
  return { subject: context.businessName, body: slot };
}

/** Minimal RTL-aware HTML wrapper. No external CSS survives email clients. */
export function toHtml(subject: string, body: string) {
  const paragraphs = body
    .split("\n\n")
    .map(
      (block) =>
        `<p style="margin:0 0 16px;white-space:pre-line">${escapeHtml(block)}</p>`,
    )
    .join("");

  return (
    `<!doctype html><html dir="rtl" lang="he"><body style="margin:0;padding:24px;` +
    `background:#f5f5f5;font-family:Arial,Helvetica,sans-serif;color:#171717">` +
    `<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:24px">` +
    `<h1 style="margin:0 0 16px;font-size:18px">${escapeHtml(subject)}</h1>` +
    `${paragraphs}</div></body></html>`
  );
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
