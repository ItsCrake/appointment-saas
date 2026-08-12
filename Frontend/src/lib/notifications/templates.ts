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

    /**
     * The request landed. Deliberately does **not** say "נקבע" anywhere: the
     * client has not got a booking yet, and a message that reads like a
     * confirmation is how someone turns up to a shop expecting them.
     *
     * It still carries the manage link. The time is genuinely held for them
     * while the owner decides, so being able to withdraw is real.
     */
    case "booking_pending":
      return {
        subject: `בקשתך ב${context.businessName} התקבלה וממתינה לאישור`,
        body:
          `היי ${context.clientName},\n\n` +
          `קיבלנו את בקשתך לתור ב${context.businessName}. היא ממתינה לאישור העסק — נעדכן אותך ברגע שתאושר.\n\n` +
          `${context.serviceName} · ${price}\n${slot}${where}\n\n` +
          `לצפייה או ביטול הבקשה: ${context.manageUrl}${contact}`,
      };

    case "booking_approved":
      return {
        subject: `התור שלך ב${context.businessName} אושר`,
        body:
          `היי ${context.clientName},\n\n` +
          `הבקשה שלך אושרה — התור ב${context.businessName} קבוע.\n\n` +
          `${context.serviceName} · ${price}\n${slot}${where}\n\n` +
          `לצפייה או ביטול: ${context.manageUrl}${contact}`,
      };

    /**
     * Separate from `cancellation_confirmation` because "בוטל" is wrong for
     * something that was never confirmed, and because by dispatch time both
     * are simply `cancelled` — the status cannot tell them apart.
     *
     * Ends by pointing back at the booking page: a refusal with no next step
     * is where a client gives up on a shop that would happily see them an hour
     * later.
     */
    case "booking_rejected":
      return {
        subject: `בקשתך ב${context.businessName} לא אושרה`,
        body:
          `היי ${context.clientName},\n\n` +
          `הבקשה שלך לתור ב${context.businessName} ל${slot} לא אושרה הפעם.\n\n` +
          `אפשר לבחור מועד אחר כאן: ${context.bookingUrl}${contact}`,
      };

    /**
     * The only marketing message this product sends, and the copy carries
     * three legal obligations rather than one tone.
     *
     * - **The sender is named in the first line.** דבר פרסומת must identify
     *   who is advertising; a message that opens "היי, מתגעגעים אליך" from an
     *   unknown WhatsApp number is both unlawful and indistinguishable from a
     *   scam.
     * - **The opt-out is in the message, not behind a link.** A one-word reply
     *   is the lowest-friction exit available on WhatsApp, and it is what
     *   `marketing_opt_outs` exists to honour.
     * - **`slot` is deliberately unused here.** Every other client template
     *   leads with a date; this one is about the absence of one, and quoting
     *   the last visit back at somebody reads as surveillance rather than
     *   warmth.
     */
    case "client_winback":
      return {
        subject: `${context.businessName} — מתגעגעים אליך`,
        body:
          `היי ${context.clientName},\n\n` +
          `כאן ${context.businessName}. מזמן לא התראינו — ` +
          `נשמח לראות אותך שוב.\n\n` +
          `לקביעת תור: ${context.bookingUrl}${where}${contact}\n\n` +
          `להסרה מרשימת הדיוור השיבו "הסר".`,
      };

    case "booking_alert": {
      // A request the owner still has to act on is not the same message as a
      // booking that simply happened, and the subject line is the only part
      // most owners read on a phone.
      const awaiting = context.status === "pending";
      return {
        subject: awaiting
          ? `ממתין לאישורך: ${context.clientName} — ${slot}`
          : `תור חדש: ${context.clientName} — ${slot}`,
        body:
          (awaiting
            ? `התקבלה בקשה לתור ב${context.businessName} וממתינה לאישורך.\n\n`
            : `נקבע תור חדש ב${context.businessName}.\n\n`) +
          `לקוח: ${context.clientName}\n` +
          `שירות: ${context.serviceName} · ${price}\n` +
          `מועד: ${slot}` +
          (awaiting ? `\n\nלאישור או דחייה: ${context.bookingUrl}` : ""),
      };
    }

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
