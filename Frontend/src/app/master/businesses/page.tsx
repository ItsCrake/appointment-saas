import { TenantTable } from "@/components/master/tenant-table";
import { db } from "@/db";
import { requireSuperAdmin } from "@/lib/master-session";
import { getOwnerEmails, listTenants } from "@/db/queries";
import { daysUntil } from "@/lib/platform-metrics";

export const dynamic = "force-dynamic";

const dateLabel = (value: Date) =>
  new Intl.DateTimeFormat("he-IL", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  }).format(value);

/** Turns a trial end into something an operator can act on at a glance. */
function trialCell(trialEndsAt: Date | null, now: Date) {
  const days = daysUntil(trialEndsAt, now);
  if (days === null) return { label: "—", urgent: false };
  if (days < 0)
    return { label: `פג לפני ${Math.abs(days)} ימים`, urgent: true };
  if (days === 0) return { label: "פג היום", urgent: true };
  return { label: `${days} ימים`, urgent: days <= 2 };
}

export default async function MasterBusinessesPage() {
  await requireSuperAdmin();

  const now = new Date();
  const tenants = await listTenants(db);

  // One batched lookup rather than a join: see getOwnerEmails.
  const emails = await getOwnerEmails(
    db,
    tenants.map((t) => t.ownerUserId),
  );

  return (
    <div>
      <header className="mb-5">
        <h1 className="text-xl font-bold text-slate-50">עסקים</h1>
        <p className="mt-0.5 text-sm text-slate-500">
          חיפוש, כניסת תמיכה, הארכת ניסיון והקפאה
        </p>
      </header>

      <TenantTable
        tenants={tenants.map((t) => {
          const trial = trialCell(t.trialEndsAt, now);
          return {
            id: t.id,
            name: t.name,
            slug: t.slug,
            ownerEmail: emails.get(t.ownerUserId) ?? null,
            createdLabel: dateLabel(t.createdAt),
            isActive: t.isActive,
            subscriptionStatus: t.subscriptionStatus,
            planType: t.planType,
            trialLabel: trial.label,
            trialUrgent: trial.urgent,
            bookings: t.bookings,
          };
        })}
      />
    </div>
  );
}
