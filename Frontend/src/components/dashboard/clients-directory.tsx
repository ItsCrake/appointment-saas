"use client";

import { useMemo, useState } from "react";
import { MessageCircle, Phone, Search, Users, X } from "lucide-react";

import { toE164 } from "@/lib/notifications/providers";
import { cn } from "@/lib/utils";

import { cardClass, EmptyState, inputClass } from "./ui";

export type DirectoryClient = {
  clientPhone: string;
  clientName: string;
  bookings: number;
  lastVisitDate: string;
};

/**
 * Filtering happens on the client over an already-loaded list rather than
 * through a `?q=` round trip. A single tenant's client list is small — it is
 * derived from their own appointment history — so this is instant per
 * keystroke, and the page stays a plain server render with no search state in
 * the URL.
 */
export function ClientsDirectory({ clients }: { clients: DirectoryClient[] }) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return clients;

    // Digits-only comparison as well, so "050-123" matches "0501234567".
    const digits = needle.replace(/\D/g, "");

    return clients.filter((client) => {
      if (client.clientName.toLowerCase().includes(needle)) return true;
      if (!digits) return false;
      return client.clientPhone.replace(/\D/g, "").includes(digits);
    });
  }, [clients, query]);

  if (clients.length === 0) {
    return (
      <EmptyState
        icon={<Users className="size-5" />}
        title="עדיין אין לקוחות"
        body="לקוחות יופיעו כאן אוטומטית אחרי התור הראשון שלהם — אין מה להגדיר."
      />
    );
  }

  return (
    <div>
      <div className="relative mb-4">
        <Search
          aria-hidden
          className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-neutral-400"
        />
        <label htmlFor="client-search" className="sr-only">
          חיפוש לקוח
        </label>
        <input
          id="client-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="חיפוש לפי שם או טלפון"
          className={cn(inputClass, "ps-9 pe-9")}
        />
        {query ? (
          <button
            type="button"
            onClick={() => setQuery("")}
            aria-label="ניקוי החיפוש"
            className="absolute end-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-neutral-400 transition-colors hover:text-neutral-700 dark:hover:text-neutral-200"
          >
            <X className="size-4" />
          </button>
        ) : null}
      </div>

      {/* Announced, so a screen reader learns the list shrank as they type. */}
      <p aria-live="polite" className="mb-3 text-xs text-neutral-500">
        {query
          ? `${filtered.length} מתוך ${clients.length} לקוחות`
          : `${clients.length} לקוחות`}
      </p>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<Search className="size-5" />}
          title="לא נמצאו לקוחות"
          body="נסו שם חלקי או ספרות מתוך מספר הטלפון."
        />
      ) : (
        <>
          {/* Desktop: a real table. */}
          <div className={cn("hidden overflow-hidden md:block", cardClass)}>
            <table className="w-full text-start text-sm">
              <thead className="border-b border-neutral-200 bg-neutral-50 text-xs text-neutral-500 dark:border-neutral-800 dark:bg-neutral-800/50">
                <tr>
                  <Th>שם</Th>
                  <Th>טלפון</Th>
                  <Th>תורים</Th>
                  <Th>ביקור אחרון</Th>
                  <Th>פעולות</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                {filtered.map((client) => (
                  <tr
                    key={client.clientPhone}
                    className="transition-colors hover:bg-teal-50/40 dark:hover:bg-neutral-800/40"
                  >
                    <Td>
                      <span className="font-medium text-neutral-900 dark:text-neutral-100">
                        {client.clientName}
                      </span>
                    </Td>
                    <Td>
                      <span
                        dir="ltr"
                        className="text-neutral-600 tabular-nums dark:text-neutral-400"
                      >
                        {client.clientPhone}
                      </span>
                    </Td>
                    <Td>
                      <span className="tabular-nums">{client.bookings}</span>
                    </Td>
                    <Td>
                      <span className="text-neutral-500 tabular-nums">
                        {client.lastVisitDate}
                      </span>
                    </Td>
                    <Td>
                      <ContactShortcuts client={client} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile: cards, because a 5-column table does not fit a phone. */}
          <ul className="space-y-2 md:hidden">
            {filtered.map((client) => (
              <li key={client.clientPhone} className={cn("p-4", cardClass)}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-neutral-900 dark:text-neutral-100">
                      {client.clientName}
                    </p>
                    <p className="mt-0.5 text-xs text-neutral-500">
                      {client.bookings} תורים · ביקור אחרון{" "}
                      {client.lastVisitDate}
                    </p>
                    <p
                      dir="ltr"
                      className="mt-0.5 text-start text-xs text-neutral-400 tabular-nums"
                    >
                      {client.clientPhone}
                    </p>
                  </div>
                  <ContactShortcuts client={client} />
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function ContactShortcuts({ client }: { client: DirectoryClient }) {
  // WhatsApp needs E.164 without the plus; the same helper the SMS provider
  // uses, so one phone format rule serves both.
  const wa = toE164(client.clientPhone).replace("+", "");

  return (
    <span className="flex shrink-0 items-center gap-1.5">
      <a
        href={`tel:${client.clientPhone}`}
        aria-label={`התקשרות ל${client.clientName}`}
        className="inline-flex size-9 items-center justify-center rounded-lg border border-neutral-200 text-neutral-600 transition-colors hover:border-teal-700 hover:text-teal-800 focus-visible:ring-2 focus-visible:ring-teal-700 focus-visible:outline-none dark:border-neutral-700 dark:text-neutral-400 dark:hover:text-teal-300"
      >
        <Phone className="size-4" aria-hidden />
      </a>
      <a
        href={`https://wa.me/${wa}`}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`וואטסאפ ל${client.clientName}`}
        className="inline-flex size-9 items-center justify-center rounded-lg border border-neutral-200 text-neutral-600 transition-colors hover:border-teal-700 hover:text-teal-800 focus-visible:ring-2 focus-visible:ring-teal-700 focus-visible:outline-none dark:border-neutral-700 dark:text-neutral-400 dark:hover:text-teal-300"
      >
        <MessageCircle className="size-4" aria-hidden />
      </a>
    </span>
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
