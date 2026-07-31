import { CalendarDays, CalendarRange, UserX, XCircle } from "lucide-react";

import { cn } from "@/lib/utils";

export type StatsCardsProps = {
  todayCount: number;
  weekCount: number;
  pastCount: number;
  cancelledCount: number;
  noShowCount: number;
  cancellationRate: number;
  noShowRate: number;
  ratesWindowDays: number;
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
}: StatsCardsProps) {
  // With almost no history a percentage is noise — 1 of 2 is not "50%".
  const ratesAreMeaningful = pastCount >= 5;

  return (
    <dl className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Card
        icon={<CalendarDays className="size-4" aria-hidden />}
        label="היום"
        value={String(todayCount)}
        hint={todayCount === 1 ? "תור אחד" : `${todayCount} תורים`}
      />
      <Card
        icon={<CalendarRange className="size-4" aria-hidden />}
        label="השבוע"
        value={String(weekCount)}
        hint="מיום ראשון"
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
  tone?: "neutral" | "warn";
}) {
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <dt className="flex items-center gap-1.5 text-xs font-medium text-neutral-500">
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
