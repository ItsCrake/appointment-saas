import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { SetupFlow } from "@/components/dashboard/setup-flow";
import { db } from "@/db";
import { listServices, listWorkingHours } from "@/db/queries";
import { configuredAppUrl, originFromHeaders, pickAppUrl } from "@/lib/app-url";
import { requireBusinessForSetup } from "@/lib/dashboard-session";
import { isOnboardingPreset } from "@/lib/onboarding-presets";
import { toPlanType } from "@/lib/plans";

export const metadata: Metadata = { title: "הקמת העסק" };
export const dynamic = "force-dynamic";

const STEPS = [
  "preset",
  "details",
  "services",
  "hours",
  "plan",
  "done",
] as const;
type Step = (typeof STEPS)[number];

type PageProps = {
  searchParams: Promise<{ step?: string; plan?: string; preset?: string }>;
};

export default async function SetupPage({ searchParams }: PageProps) {
  const { business } = await requireBusinessForSetup();

  // Finished owners have no business here; the dashboard is theirs now.
  if (business?.onboardingCompletedAt) redirect("/dashboard");

  // ?plan= comes from the landing page's pricing cards, so a tier chosen
  // before signing up survives into the wizard.
  const {
    step: rawStep,
    plan: requestedPlan,
    preset: requestedPreset,
  } = await searchParams;
  const requested = STEPS.includes(rawStep as Step) ? (rawStep as Step) : null;

  /**
   * Steps beyond the first need a business row — but "the first step" is now
   * `preset` for a brand-new owner and `details` for one returning mid-flow.
   *
   * Without a row the only reachable steps are `preset` and `details`, so a
   * deep link past them falls back rather than erroring. With a row, an owner
   * who already named their shop should not be sent back to pick a trade, so
   * an absent `?step=` resumes at `details`.
   */
  const step: Step = !business
    ? requested === "details"
      ? "details"
      : "preset"
    : (requested ?? "details");

  /**
   * The saved choice wins over the query hint: once it is on the row, that is
   * the answer. `?preset=` only matters for the one navigation between step 0
   * and step 1, before there is anywhere to put it.
   */
  const presetValue = business?.onboardingPreset ?? requestedPreset ?? null;
  const preset = isOnboardingPreset(presetValue) ? presetValue : null;

  const [services, hours] = business
    ? await Promise.all([
        listServices(db, business.id, { activeOnly: false }),
        listWorkingHours(db, business.id),
      ])
    : [[], []];

  // Resolved from the live request rather than from the env alone. A deploy
  // whose NEXT_PUBLIC_APP_URL is unset or still says localhost otherwise puts
  // an unopenable link in front of an owner about to share it with customers.
  const requestHeaders = await headers();
  const appUrl = pickAppUrl(
    configuredAppUrl(),
    originFromHeaders((name) => requestHeaders.get(name)),
  );

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
        preset={preset}
        appUrl={appUrl}
      />
    </div>
  );
}
