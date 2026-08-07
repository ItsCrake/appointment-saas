import { Activity } from "lucide-react";

import { EmptyPanel, panel } from "@/components/master/ui";
import { StatusChip } from "@/components/dashboard/ui";
import { db } from "@/db";
import { requireSuperAdmin } from "@/lib/master-session";
import { listGlobalFeed } from "@/db/queries";
import { formatFullDateTime, formatPrice } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function MasterLivePage() {
  await requireSuperAdmin();

  const feed = await listGlobalFeed(db);

  return (
    <div>
      <header className="mb-5">
        <h1 className="flex items-center gap-2 text-xl font-bold text-zinc-50">
          <Activity className="size-5 text-indigo-400" aria-hidden />
          פעילות בלייב
        </h1>
        <p className="mt-0.5 text-sm text-zinc-500">
          התורים האחרונים שנקבעו בכל הפלטפורמה. שמות וטלפונים של לקוחות אינם
          נטענים לכאן.
        </p>
      </header>

      {feed.length === 0 ? (
        <EmptyPanel
          title="עוד לא נקבעו תורים"
          body="ברגע שלקוח יקבע תור אצל אחד העסקים הוא יופיע כאן."
        />
      ) : (
        <ul className="space-y-2">
          {feed.map((entry) => {
            // Rendered in the *tenant's* timezone: an operator reading this
            // needs to know what time it was in the shop, not on the server.
            const when = formatFullDateTime(
              entry.startsAt.toISOString(),
              entry.businessTimezone,
            );
            const booked = formatFullDateTime(
              entry.createdAt.toISOString(),
              entry.businessTimezone,
            );

            return (
              <li
                key={entry.id}
                className={`${panel} flex items-center gap-3 px-4 py-3`}
              >
                <span className="w-16 shrink-0 text-xs text-zinc-500 tabular-nums">
                  {booked.time}
                </span>

                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-semibold text-zinc-100">
                      {entry.businessName}
                    </span>
                    <span
                      dir="ltr"
                      className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400"
                    >
                      /{entry.businessSlug}
                    </span>
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-zinc-500">
                    {entry.serviceName} · {formatPrice(entry.priceCents)} ·
                    לתאריך {when.date} {when.time}
                  </span>
                </span>

                <StatusChip status={entry.status} />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
