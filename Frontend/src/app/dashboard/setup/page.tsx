import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { SetupFlow } from "@/components/dashboard/setup-flow";
import { db } from "@/db";
import { listServices, listWorkingHours } from "@/db/queries";
import { requireBusinessForSetup } from "@/lib/dashboard-session";
import { toPlanType } from "@/lib/plans";

export const metadata: Metadata = { title: "הקמת העסק" };
export const dynamic = "force-dynamic";

const STEPS = ["details", "services", "hours", "plan", "done"] as const;
type Step = (typeof STEPS)[number];

type PageProps = { searchParams: Promise<{ step?: string; plan?: string }> };

export default async function SetupPage({ searchParams }: PageProps) {
  const { business } = await requireBusinessForSetup();

  // Finished owners have no business here; the dashboard is theirs now.
  if (business?.onboardingCompletedAt) redirect("/dashboard");

  // ?plan= comes from the landing page's pricing cards, so a tier chosen
  // before signing up survives into the wizard.
  const { step: rawStep, plan: requestedPlan } = await searchParams;
  const requested = STEPS.includes(rawStep as Step) ? (rawStep as Step) : null;

  // Steps beyond the first need a business row, so a deep link without one
  // falls back to step 1 rather than erroring.
  const step: Step = !business ? "details" : (requested ?? "details");

  const [services, hours] = business
    ? await Promise.all([
        listServices(db, business.id, { activeOnly: false }),
        listWorkingHours(db, business.id),
      ])
    : [[], []];

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  return (
    <div className="mx-auto max-w-xl">
      <SetupFlow
        step={step}
        business={
          business
            ? {
                name: business.name,
                slug: business.slug,
                phone: business.phone ?? "",
                timezone: business.timezone,
              }
            : null
        }
        services={services.map((s) => ({
          id: s.id,
          name: s.name,
          durationMin: s.durationMin,
          priceCents: s.priceCents,
        }))}
        shifts={hours
          .filter((h) => !h.isClosed)
          .map((h) => ({
            weekday: h.weekday,
            startTime: h.startTime.slice(0, 5),
            endTime: h.endTime.slice(0, 5),
          }))}
        planType={toPlanType(business?.planType ?? requestedPlan)}
        appUrl={appUrl}
      />
    </div>
  );
}
