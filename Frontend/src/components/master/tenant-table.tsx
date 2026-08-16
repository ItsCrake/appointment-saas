"use client";

import { useMemo, useState, useTransition } from "react";
import {
  CalendarPlus,
  KeyRound,
  Loader2,
  Play,
  Search,
  Snowflake,
} from "lucide-react";

import {
  extendTrialAction,
  impersonateAction,
  setTenantActiveAction,
  updateTenantPlanAction,
} from "@/app/master/actions";
import { effectivePlan } from "@/lib/entitlements";
import { ASSIGNABLE_PLANS, planLabel, toPlanType } from "@/lib/plans";
import { cn } from "@/lib/utils";

import {
  EmptyPanel,
  masterBtn,
  masterBtnDanger,
  masterInput,
  masterSelect,
  panel,
  TenantPill,
  tenantState,
} from "./ui";

export type TenantRowView = {
  id: string;
  name: string;
  slug: string;
  ownerEmail: string | null;
  createdLabel: string;
  isActive: boolean;
  subscriptionStatus: string;
  planType: string;
  trialLabel: string;
  trialUrgent: boolean;
  bookings: number;
};

export function TenantTable({ tenants }: { tenants: TenantRowView[] }) {
  const [query, setQuery] = useState("");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();
  const [, startTransition] = useTransition();

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return tenants;
    return tenants.filter(
      (t) =>
        t.name.toLowerCase().includes(needle) ||
        t.slug.toLowerCase().includes(needle) ||
        (t.ownerEmail ?? "").toLowerCase().includes(needle),
    );
  }, [tenants, query]);

  function run(
    id: string,
    fn: () => Promise<{ ok: boolean; message?: string; error?: string }>,
  ) {
    setPendingId(id);
    setNotice(undefined);
    setError(undefined);
    startTransition(async () => {
      const result = await fn();
      setPendingId(null);
      if (result.ok) setNotice(result.message);
      else setError(result.error);
    });
  }

  if (tenants.length === 0) {
    return (
      <EmptyPanel
        title="אין עדיין עסקים"
        body="הרשימה תתמלא אוטומטית ככל שעסקים חדשים ישלימו הרשמה."
      />
    );
  }

  return (
    <div>
      <div className="relative mb-4">
        <Search
          aria-hidden
          className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-zinc-500"
        />
        <label htmlFor="tenant-search" className="sr-only">
          חיפוש עסק
        </label>
        <input
          id="tenant-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="חיפוש לפי שם עסק, כתובת או אימייל בעלים"
          className={cn(masterInput, "ps-9")}
        />
      </div>

      <p aria-live="polite" className="mb-3 text-xs text-zinc-500">
        {query
          ? `${filtered.length} מתוך ${tenants.length}`
          : `${tenants.length} עסקים`}
      </p>

      {notice ? (
        <p
          role="status"
          className="mb-3 rounded-lg bg-emerald-950/60 px-3 py-2 text-xs text-emerald-300"
        >
          {notice}
        </p>
      ) : null}
      {error ? (
        <p
          role="alert"
          className="mb-3 rounded-lg bg-rose-950/60 px-3 py-2 text-xs text-rose-300"
        >
          {error}
        </p>
      ) : null}

      {filtered.length === 0 ? (
        <EmptyPanel
          title="לא נמצאו עסקים"
          body="נסו שם חלקי או חלק מהאימייל."
        />
      ) : (
        <div className={cn("overflow-x-auto", panel)}>
          <table className="w-full min-w-[900px] text-start text-sm">
            <thead className="border-b border-zinc-800 text-xs text-zinc-500">
              <tr>
                <Th>עסק</Th>
                <Th>בעלים</Th>
                <Th>נוצר</Th>
                <Th>סטטוס</Th>
                <Th>מסלול</Th>
                <Th>ניסיון</Th>
                <Th>תורים</Th>
                <Th>פעולות</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/70">
              {filtered.map((t) => {
                const busy = pendingId === t.id;
                return (
                  <tr
                    key={t.id}
                    className="transition-colors hover:bg-zinc-800/30"
                  >
                    <Td>
                      <span className="block font-medium text-zinc-100">
                        {t.name}
                      </span>
                      <span
                        dir="ltr"
                        className="block text-[11px] text-zinc-500"
                      >
                        /{t.slug}
                      </span>
                    </Td>
                    <Td>
                      <span dir="ltr" className="text-xs text-zinc-400">
                        {t.ownerEmail ?? "—"}
                      </span>
                    </Td>
                    <Td>
                      <span className="text-xs text-zinc-400 tabular-nums">
                        {t.createdLabel}
                      </span>
                    </Td>
                    <Td>
                      <TenantPill
                        state={tenantState(t.isActive, t.subscriptionStatus)}
                      />
                    </Td>
                    <Td>
                      <PlanCell tenant={t} />
                    </Td>
                    <Td>
                      <span
                        className={cn(
                          "text-xs tabular-nums",
                          t.trialUrgent
                            ? "font-semibold text-amber-300"
                            : "text-zinc-400",
                        )}
                      >
                        {t.trialLabel}
                      </span>
                    </Td>
                    <Td>
                      <span className="text-xs text-zinc-300 tabular-nums">
                        {t.bookings}
                      </span>
                    </Td>
                    <Td>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            run(t.id, () =>
                              impersonateAction({ businessId: t.id }),
                            )
                          }
                          className={masterBtn}
                          title="כניסה ללוח הבקרה של העסק לצורכי תמיכה"
                        >
                          {busy ? (
                            <Loader2
                              className="size-3.5 animate-spin"
                              aria-hidden
                            />
                          ) : (
                            <KeyRound className="size-3.5" aria-hidden />
                          )}
                          התחבר
                        </button>

                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            run(t.id, () =>
                              extendTrialAction({ businessId: t.id, days: 7 }),
                            )
                          }
                          className={masterBtn}
                        >
                          <CalendarPlus className="size-3.5" aria-hidden />
                          7+ ימים
                        </button>

                        {/* Beside the trial button, because the two are the
                            same job: deciding what this tenant is entitled to
                            without a payment provider in the loop. */}
                        <label className="contents">
                          <span className="sr-only">מסלול עבור {t.name}</span>
                          <select
                            disabled={busy}
                            value={toPlanType(t.planType)}
                            onChange={(event) =>
                              run(t.id, () =>
                                updateTenantPlanAction({
                                  businessId: t.id,
                                  planType: event.target.value,
                                }),
                              )
                            }
                            className={masterSelect}
                          >
                            {ASSIGNABLE_PLANS.map((plan) => (
                              <option key={plan} value={plan}>
                                {planLabel(plan)}
                              </option>
                            ))}
                          </select>
                        </label>

                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            run(t.id, () =>
                              setTenantActiveAction({
                                businessId: t.id,
                                isActive: !t.isActive,
                              }),
                            )
                          }
                          className={t.isActive ? masterBtnDanger : masterBtn}
                        >
                          {t.isActive ? (
                            <>
                              <Snowflake className="size-3.5" aria-hidden />
                              הקפא
                            </>
                          ) : (
                            <>
                              <Play className="size-3.5" aria-hidden />
                              הפעל
                            </>
                          )}
                        </button>
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * The tier stored on the row, and — when they differ — the tier the tenant is
 * actually being served.
 *
 * Both are shown because entitlements resolve from plan *and* status, so the
 * stored value alone is misleading in the two commonest states an admin looks
 * at. A trialing tenant is served Pro whatever is stored, and a `past_due` one
 * is served nothing. Without this, moving a trialing tenant to Basic looks like
 * a control that did not work — the write succeeded and the product did not
 * change, which is the single most likely support ticket this feature creates.
 *
 * `effectivePlan` is the same pure function the server gates on, imported
 * rather than reimplemented, so the console cannot describe a tenant's access
 * differently from the way it is enforced.
 */
function PlanCell({ tenant }: { tenant: TenantRowView }) {
  const stored = toPlanType(tenant.planType);
  const served = effectivePlan(tenant);

  return (
    <div className="text-xs">
      <span className="block font-medium text-zinc-200">
        {planLabel(stored)}
      </span>
      {served !== stored ? (
        <span className="mt-0.5 block text-[11px] text-amber-300">
          בפועל: {planLabel(served)}
        </span>
      ) : null}
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
  return <td className="px-4 py-3 align-top">{children}</td>;
}
