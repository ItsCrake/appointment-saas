import {
  CalendarDays,
  CalendarRange,
  UserPlus,
  UserX,
  Wallet,
  XCircle,
} from "lucide-react";

import { formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";

export type StatsCardsProps = {
  todayCount: number;
  weekCount: number;
  upcomingCount: number;
  pastCount: number;
  cancelledCount: number;
  noShowCount: number;
  cancellationRate: number;
  noShowRate: number;
  ratesWindowDays: number;
  todayRevenueCents: number;
  newClientsThisWeek: number;
};

export function StatsCards({
  todayCount,
  weekCount,
  pastCount,
  cancelledCount,
  noShowCount,
  cancellationRate,
  noShowRate,
  ratesWindowDays,
  todayRevenueCents,
  newClientsThisWeek,
}: StatsCardsProps) {
  // With almost no history a percentage is noise — 1 of 2 is not "50%".
  const ratesAreMeaningful = pastCount >= 5;

  return (
    <dl className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
      <Card
        icon={<CalendarDays className="size-4" aria-hidden />}
        label="היום"
        value={String(todayCount)}
        hint={todayCount === 1 ? "תור אחד" : `${todayCount} תורים`}
        tone="accent"
      />
      <Card
        icon={<Wallet className="size-4" aria-hidden />}
        label="הכנסה צפויה"
        value={formatPrice(todayRevenueCents)}
        // "Expected" is doing real work here: nothing in this product records
        // a payment, so this is the value of today's bookings, not takings.
        hint="לפי התורים של היום"
        tone="accent"
      />
      <Card
        icon={<CalendarRange className="size-4" aria-hidden />}
        label="השבוע"
        value={String(weekCount)}
        hint="מיום ראשון"
      />
      <Card
        icon={<UserPlus className="size-4" aria-hidden />}
        label="לקוחות חדשים"
        value={String(newClientsThisWeek)}
        hint="שהזמינו לראשונה השבוע"
      />
      <Card
        icon={<XCircle className="size-4" aria-hidden />}
        label="ביטולים"
        value={ratesAreMeaningful ? `${cancellationRate}%` : "—"}
        hint={
          ratesAreMeaningful
            ? `${cancelledCount} מתוך ${pastCount}`
            : "אין מספיק נתונים"
        }
        tone={ratesAreMeaningful && cancellationRate >= 20 ? "warn" : "neutral"}
      />
      <Card
        icon={<UserX className="size-4" aria-hidden />}
        label="לא הגיעו"
        value={ratesAreMeaningful ? `${noShowRate}%` : "—"}
        hint={
          ratesAreMeaningful
            ? `${noShowCount} מתוך ${pastCount}`
            : `${ratesWindowDays} ימים אחרונים`
        }
        tone={ratesAreMeaningful && noShowRate >= 15 ? "warn" : "neutral"}
      />
    </dl>
  );
}

function Card({
  icon,
  label,
  value,
  hint,
  tone = "neutral",
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint: string;
  tone?: "neutral" | "warn" | "accent";
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border p-4 transition-colors",
        tone === "accent"
          ? "border-teal-200 bg-teal-50/60 dark:border-teal-900 dark:bg-teal-950/30"
          : "border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900",
      )}
    >
      <dt
        className={cn(
          "flex items-center gap-1.5 text-xs font-medium",
          tone === "accent"
            ? "text-teal-800 dark:text-teal-300"
            : "text-neutral-500",
        )}
      >
        {icon}
        {label}
      </dt>
      <dd>
        <span
          className={cn(
            "mt-1.5 block text-2xl leading-none font-bold tabular-nums",
            tone === "warn"
              ? "text-amber-600 dark:text-amber-400"
              : "text-neutral-900 dark:text-neutral-50",
          )}
        >
          {value}
        </span>
        <span className="mt-1 block text-[11px] text-neutral-400">{hint}</span>
      </dd>
    </div>
  );
}
