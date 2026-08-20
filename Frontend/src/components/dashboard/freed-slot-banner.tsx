"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  BellRing,
  Check,
  Copy,
  Loader2,
  MessageCircle,
  Users,
  X,
} from "lucide-react";

import {
  inviteWaitlistForSlotAction,
  type InvitedClient,
} from "@/app/dashboard/waitlist/actions";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

import { btnSecondary } from "./ui";

export type FreedSlot = {
  appointmentId: string;
  /** "יום ג׳, 12/08 · 14:00", resolved server-side in the shop's timezone. */
  label: string;
  serviceName: string | null;
  staffName: string | null;
  /** How many live entries match this slot. Always at least one, or no banner. */
  matches: number;
};

/**
 * "A slot just opened, and people are waiting for one like it."
 *
 * ---------------------------------------------------------------------------
 * **Only rendered when there is something to do about it.** The server sends a
 * slot only if it is in the future, was cancelled recently, has at least one
 * matching entry, and has not already been offered to anybody — so the banner's
 * presence is itself the message, and it disappears once acted on without
 * needing a dismiss button or a piece of state to remember it was dismissed.
 *
 * **The links are the deliverable, not a fallback.** There is no approved Meta
 * template for a waitlist invite yet, so the automated send is refused on the
 * official WhatsApp path — see PROJECT_PLAN §5. Rather than reporting success
 * into a void, the action hands back one link per invited client and this shows
 * them: a WhatsApp button that opens a conversation with the message ready, and
 * a copy button for anything else. The outbox row is written either way, so the
 * moment a template is approved the same button starts delivering by itself.
 * ---------------------------------------------------------------------------
 */
export function FreedSlotBanner({ slots }: { slots: FreedSlot[] }) {
  const [dismissed, setDismissed] = useState<string[]>([]);
  const visible = slots.filter((slot) => !dismissed.includes(slot.appointmentId));

  if (visible.length === 0) return null;

  return (
    <div className="mb-5 space-y-3">
      {visible.map((slot) => (
        <SlotCard
          key={slot.appointmentId}
          slot={slot}
          onDismiss={() =>
            setDismissed((current) => [...current, slot.appointmentId])
          }
        />
      ))}
    </div>
  );
}

function SlotCard({
  slot,
  onDismiss,
}: {
  slot: FreedSlot;
  onDismiss: () => void;
}) {
  const { toast } = useToast();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [invited, setInvited] = useState<InvitedClient[] | null>(null);
  const [autoSent, setAutoSent] = useState(false);

  function invite() {
    startTransition(async () => {
      const result = await inviteWaitlistForSlotAction(slot.appointmentId);
      if (result.ok) {
        setInvited(result.invited);
        setAutoSent(result.queued);
        toast(
          result.remaining > 0
            ? `נשלחה הצעה ל-${result.invited.length} ממתינים (עוד ${result.remaining} ברשימה)`
            : `נשלחה הצעה ל-${result.invited.length} ממתינים`,
        );
        router.refresh();
      } else {
        toast(result.error, "error");
      }
    });
  }

  return (
    <section
      className={cn(
        "rounded-2xl border p-4",
        "border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span
            aria-hidden
            className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-amber-200 text-amber-900 dark:bg-amber-900 dark:text-amber-200"
          >
            <BellRing className="size-4.5" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-bold text-amber-900 dark:text-amber-100">
              התפנה תור ב{slot.label}
            </p>
            <p className="mt-0.5 text-xs leading-relaxed text-amber-800 dark:text-amber-200">
              {slot.serviceName ? `${slot.serviceName} · ` : ""}
              {slot.staffName ? `${slot.staffName} · ` : ""}
              <span className="font-semibold">
                {slot.matches === 1
                  ? "לקוח אחד ברשימת ההמתנה מתאים לתור הזה"
                  : `${slot.matches} לקוחות ברשימת ההמתנה מתאימים לתור הזה`}
              </span>
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onDismiss}
          aria-label="הסתרה"
          className="-me-1 shrink-0 rounded-lg p-1.5 text-amber-700/70 transition-colors hover:bg-amber-100 hover:text-amber-900 dark:hover:bg-amber-900/50"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>

      {invited ? (
        <div className="mt-3 rounded-xl bg-white/70 p-3 dark:bg-zinc-900/50">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-zinc-700 dark:text-zinc-300">
            <Check className="size-3.5 text-emerald-600" aria-hidden />
            {autoSent
              ? "ההודעות נשלחו. אפשר גם לשלוח ידנית:"
              : "אין ערוץ שליחה פעיל — שלחו את הקישורים ידנית:"}
          </p>
          <ul className="space-y-1.5">
            {invited.map((client) => (
              <InvitedRow key={client.url} client={client} label={slot.label} />
            ))}
          </ul>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={invite}
            disabled={pending}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-amber-600 px-3 text-xs font-bold text-white transition-colors hover:bg-amber-700 disabled:opacity-60"
          >
            {pending ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <BellRing className="size-3.5" aria-hidden />
            )}
            הצעת התור לרשימת ההמתנה
          </button>

          <Link
            href="/dashboard/waitlist"
            className={cn(btnSecondary, "h-9 px-3 text-xs")}
          >
            <Users className="size-3.5" aria-hidden />
            שיבוץ ידני
          </Link>
        </div>
      )}
    </section>
  );
}

/** One invited client, with the two ways to actually get the link to them. */
function InvitedRow({
  client,
  label,
}: {
  client: InvitedClient;
  label: string;
}) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  const phone = client.phone.replace(/\D/g, "");
  const wa = phone.startsWith("0") ? `972${phone.slice(1)}` : phone;
  const message = `היי ${client.name}, התפנה תור ב${label}. לתפיסת התור: ${client.url}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // A clipboard an owner has denied is not an error worth a red toast; the
      // link is on screen and selectable either way.
      toast("לא ניתן להעתיק — אפשר לסמן ולהעתיק ידנית", "error");
    }
  }

  return (
    <li className="flex items-center justify-between gap-2">
      <span className="min-w-0 truncate text-xs text-zinc-700 dark:text-zinc-300">
        {client.name}
        <span className="ms-1.5 text-zinc-400" dir="ltr">
          {client.phone}
        </span>
      </span>
      <span className="flex shrink-0 gap-1">
        <a
          href={`https://wa.me/${wa}?text=${encodeURIComponent(message)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-7 items-center gap-1 rounded-lg border border-zinc-200 px-2 text-[11px] font-semibold text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          <MessageCircle className="size-3" aria-hidden />
          וואטסאפ
        </a>
        <button
          type="button"
          onClick={copy}
          className="inline-flex h-7 items-center gap-1 rounded-lg border border-zinc-200 px-2 text-[11px] font-semibold text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          {copied ? (
            <Check className="size-3 text-emerald-600" aria-hidden />
          ) : (
            <Copy className="size-3" aria-hidden />
          )}
          {copied ? "הועתק" : "העתקה"}
        </button>
      </span>
    </li>
  );
}
