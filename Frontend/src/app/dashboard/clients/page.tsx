import type { Metadata } from "next";
import { Phone, Users } from "lucide-react";

import { db } from "@/db";
import { listClients } from "@/db/queries";
import { requireBusiness } from "@/lib/dashboard-session";
import { formatFullDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "לקוחות" };

export default async function ClientsPage() {
  const { business } = await requireBusiness();
  const clients = await listClients(db, business.id);

  return (
    <div>
      <header className="mb-5">
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900 dark:text-neutral-50">
          לקוחות
        </h1>
        <p className="mt-0.5 text-sm text-neutral-500">
          {clients.length > 0
            ? `${clients.length} לקוחות שקבעו תור`
            : "מתוך היסטוריית התורים"}
        </p>
      </header>

      {clients.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-neutral-200 bg-white/50 px-4 py-16 text-center dark:border-neutral-800 dark:bg-neutral-900/40">
          <Users className="size-6 text-neutral-300" aria-hidden />
          <p className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
            עדיין אין לקוחות
          </p>
          <p className="text-xs text-neutral-500">
            לקוחות יופיעו כאן אוטומטית אחרי התור הראשון שלהם.
          </p>
        </div>
      ) : (
        <>
          {/* Desktop: a real table. */}
          <div className="hidden overflow-hidden rounded-2xl border border-neutral-200 bg-white md:block dark:border-neutral-800 dark:bg-neutral-900">
            <table className="w-full text-start text-sm">
              <thead className="border-b border-neutral-200 bg-neutral-50 text-xs text-neutral-500 dark:border-neutral-800 dark:bg-neutral-800/50">
                <tr>
                  <Th>שם</Th>
                  <Th>טלפון</Th>
                  <Th>תורים</Th>
                  <Th>ביקור אחרון</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                {clients.map((client) => {
                  const last = formatFullDateTime(
                    client.lastVisit.toISOString(),
                    business.timezone,
                  );
                  return (
                    <tr key={client.clientPhone}>
                      <Td>
                        <span className="font-medium text-neutral-900 dark:text-neutral-100">
                          {client.clientName}
                        </span>
                      </Td>
                      <Td>
                        <a
                          href={`tel:${client.clientPhone}`}
                          dir="ltr"
                          className="text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
                        >
                          {client.clientPhone}
                        </a>
                      </Td>
                      <Td>
                        <span className="tabular-nums">{client.bookings}</span>
                      </Td>
                      <Td>
                        <span className="text-neutral-500 tabular-nums">
                          {last.date}
                        </span>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile: cards, because a 4-column table does not fit a phone. */}
          <ul className="space-y-2 md:hidden">
            {clients.map((client) => {
              const last = formatFullDateTime(
                client.lastVisit.toISOString(),
                business.timezone,
              );
              return (
                <li
                  key={client.clientPhone}
                  className="rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-neutral-900 dark:text-neutral-100">
                        {client.clientName}
                      </p>
                      <p className="mt-0.5 text-xs text-neutral-500">
                        {client.bookings} תורים · ביקור אחרון {last.date}
                      </p>
                    </div>
                    <a
                      href={`tel:${client.clientPhone}`}
                      aria-label={`התקשרות ל${client.clientName}`}
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-neutral-200 px-3 py-2 text-xs font-semibold text-neutral-700 dark:border-neutral-700 dark:text-neutral-300"
                    >
                      <Phone className="size-3.5" aria-hidden />
                      <span dir="ltr">{client.clientPhone}</span>
                    </a>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th scope="col" className="px-4 py-3 text-start font-medium">
      {children}
    </th>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-4 py-3">{children}</td>;
}
