import { BRAND } from "@/lib/brand";
import { formatFullDateTime, formatPrice } from "@/lib/format";

import {
  isBillingKind,
  type BillingContext,
  type NotificationContext,
} from "./types";

/**
 * Narrows the context, not just its `kind`. A guard on `context.kind` alone
 * tells TypeScript nothing about the object it came from, so the appointment
 * branch below would still see optional billing fields.
 */
function isBillingContext(
  context: NotificationContext,
): context is BillingContext {
  return isBillingKind(context.kind);
}

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
  if (isBillingContext(context)) return renderBilling(context);

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
  // No fallback: the switch is exhaustive over `AppointmentKind`, so `context`
  // is `never` here. Adding a kind without a case is now a compile error
  // rather than a silently generic email.
}

/**
 * Billing copy. Addressed to the owner about their own account, so it uses the
 * business name rather than a client name and never mentions an appointment.
 *
 * Deliberately plain about consequences. A dunning notice that is vague about
 * what stops working, and when, produces a support ticket instead of a
 * payment.
 */
function renderBilling(context: BillingContext): {
  subject: string;
  body: string;
} {
  const deadline = context.deadline
    ? formatFullDateTime(context.deadline, context.businessTimezone)
    : null;
  const deadlineText = deadline ? `${deadline.date}` : "";

  switch (context.kind) {
    case "trial_ending": {
      const days = context.daysLeft ?? 0;
      const when =
        days === 1
          ? "מחר"
          : `בעוד ${days} ימים${deadlineText ? ` (${deadlineText})` : ""}`;
      return {
        subject: `תקופת הניסיון של ${context.businessName} מסתיימת ${when}`,
        body:
          `תקופת הניסיון שלכם ב${BRAND.name} מסתיימת ${when}.\n\n` +
          `כדי להמשיך במסלול ${context.planName} ללא הפסקה, אפשר להסדיר תשלום כאן:\n` +
          `${context.billingUrl}\n\n` +
          `עמוד ההזמנות שלכם ימשיך לעבוד גם אחרי סיום הניסיון. נשלח תזכורת לפני שמשהו משתנה.`,
      };
    }

    case "trial_ended":
      return {
        subject: `תקופת הניסיון של ${context.businessName} הסתיימה`,
        body:
          `תקופת הניסיון שלכם ב${BRAND.name} הסתיימה.\n\n` +
          `עמוד ההזמנות ממשיך לעבוד והתורים הקיימים נשמרים. ` +
          `התכונות של מסלול ${context.planName} מושבתות בינתיים.\n\n` +
          `אם לא יוסדר תשלום עד ${deadlineText}, עמוד ההזמנות ייסגר לקביעת תורים חדשים.\n\n` +
          `להסדרת התשלום: ${context.billingUrl}`,
      };

    case "payment_failed":
      return {
        subject: `התשלום עבור ${context.businessName} לא עבר`,
        body:
          `לא הצלחנו לחייב את אמצעי התשלום שלכם ב${BRAND.name}.\n\n` +
          `עמוד ההזמנות ממשיך לעבוד בינתיים. ` +
          `אם התשלום לא יוסדר עד ${deadlineText}, הוא ייסגר לקביעת תורים חדשים.\n\n` +
          `לעדכון אמצעי התשלום: ${context.billingUrl}`,
      };

    case "payment_receipt":
      return {
        subject: `קבלה על התשלום ב${BRAND.name}`,
        body:
          `התקבל תשלום עבור ${context.businessName}.\n\n` +
          `מסלול: ${context.planName}\n` +
          `סכום: ${formatPrice(context.amountCents ?? 0)}\n\n` +
          `לצפייה בחשבוניות ובפרטי המנוי: ${context.billingUrl}`,
      };
  }
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

  // The signature lives here and not in `body`, because that same body is
  // what the SMS and WhatsApp providers send — a platform footer would ride
  // on every message and cost a segment.
  return (
    `<!doctype html><html dir="rtl" lang="he"><body style="margin:0;padding:24px;` +
    `background:#f5f5f5;font-family:Arial,Helvetica,sans-serif;color:#171717">` +
    `<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:24px">` +
    `<h1 style="margin:0 0 16px;font-size:18px">${escapeHtml(subject)}</h1>` +
    `${paragraphs}` +
    `<p style="margin:24px 0 0;padding-top:16px;border-top:1px solid #e5e5e5;` +
    `font-size:12px;color:#a3a3a3">נשלח באמצעות ${escapeHtml(BRAND.name)}</p>` +
    `</div></body></html>`
  );
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
