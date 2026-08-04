import { CalendarCheck, TrendingUp, Wallet } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * A product illustration, not a component of the product. It ships no
 * JavaScript — every "interactive" touch here is a CSS hover — so it stays a
 * server component even though the brief grouped it with the typewriter.
 *
 * Announced as a single image with one description rather than as a dozen
 * headings and list items, because none of these numbers are real and a screen
 * reader walking them would be reading fiction.
 */

const STATS = [
  { icon: CalendarCheck, label: "תורים היום", value: "12", tone: "teal" },
  { icon: Wallet, label: "הכנסה צפויה", value: "₪840", tone: "teal" },
  { icon: TrendingUp, label: "ניצולת יומן", value: "94%", tone: "plain" },
] as const;

const AGENDA = [
  {
    time: "09:00",
    name: "יוסי כהן",
    service: "תספורת גבר",
    status: "confirmed",
  },
  { time: "09:35", name: "דנה לוי", service: "עיצוב זקן", status: "confirmed" },
  {
    time: "10:10",
    name: "אורי מזרחי",
    service: "תספורת ילד",
    status: "pending",
  },
  {
    time: "10:35",
    name: "רון ברק",
    service: "תספורת גבר",
    status: "confirmed",
  },
] as const;

const STATUS = {
  confirmed: { label: "מאושר", className: "bg-teal-100 text-teal-800" },
  pending: { label: "ממתין", className: "bg-amber-100 text-amber-900" },
} as const;

export function DashboardMockup() {
  return (
    <div
      role="img"
      aria-label="תצוגה מקדימה של לוח הבקרה: תורים היום, הכנסה צפויה, וסדר היום עם סטטוס לכל תור"
      className="group w-full overflow-hidden rounded-2xl border border-white/10 bg-white shadow-2xl ring-1 shadow-black/40 ring-black/5 transition-transform duration-500 hover:-translate-y-1"
    >
      {/* Browser chrome */}
      <div
        aria-hidden
        className="flex items-center gap-2 border-b border-neutral-200 bg-neutral-100 px-3 py-2.5"
      >
        <span className="flex gap-1.5">
          <span className="size-2.5 rounded-full bg-red-400" />
          <span className="size-2.5 rounded-full bg-amber-400" />
          <span className="size-2.5 rounded-full bg-green-400" />
        </span>
        <span
          dir="ltr"
          className="mx-auto rounded-md bg-white px-3 py-0.5 text-[10px] text-neutral-400 tabular-nums"
        >
          bazman.app/dashboard
        </span>
      </div>

      <div aria-hidden className="bg-white p-4">
        <div className="mb-3 flex items-baseline justify-between">
          <p className="text-sm font-bold text-neutral-900">היומן שלי</p>
          <p className="text-[10px] text-neutral-400">יום שני, 7 בספטמבר</p>
        </div>

        <div className="mb-4 grid grid-cols-3 gap-2">
          {STATS.map(({ icon: Icon, label, value, tone }) => (
            <div
              key={label}
              className={cn(
                "rounded-xl border p-2.5 transition-colors duration-300",
                tone === "teal"
                  ? "border-teal-200 bg-teal-50/70 group-hover:border-teal-300"
                  : "border-neutral-200 bg-neutral-50",
              )}
            >
              <span
                className={cn(
                  "flex items-center gap-1 text-[10px] font-medium",
                  tone === "teal" ? "text-teal-800" : "text-neutral-500",
                )}
              >
                <Icon className="size-3" />
                {label}
              </span>
              <span className="mt-1 block text-lg leading-none font-bold text-neutral-900 tabular-nums">
                {value}
              </span>
            </div>
          ))}
        </div>

        <ul className="space-y-1.5">
          {AGENDA.map((row, i) => (
            <li
              key={row.time}
              // Staggered lift on hover, so the card reads as live rather than
              // as a flat screenshot.
              style={{ transitionDelay: `${i * 45}ms` }}
              className="flex items-center gap-3 rounded-xl border border-neutral-200 bg-white px-3 py-2 transition-all duration-300 group-hover:-translate-y-0.5 group-hover:border-teal-200 group-hover:shadow-sm"
            >
              <span className="text-xs font-bold text-neutral-900 tabular-nums">
                {row.time}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-semibold text-neutral-800">
                  {row.name}
                </span>
                <span className="block truncate text-[10px] text-neutral-400">
                  {row.service}
                </span>
              </span>
              <span
                className={cn(
                  "shrink-0 rounded-full px-2 py-0.5 text-[9px] font-bold",
                  STATUS[row.status].className,
                )}
              >
                {STATUS[row.status].label}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
