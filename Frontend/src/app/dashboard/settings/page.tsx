import type { Metadata } from "next";
import Link from "next/link";
import { Sparkles } from "lucide-react";

import { AppearanceForm } from "@/components/dashboard/appearance-form";
import { SettingsForm } from "@/components/dashboard/settings-form";
import {
  parseGallery,
  parseReviews,
  toThemeColor,
  type HeroMediaType,
} from "@/lib/branding";
import { requireBusiness } from "@/lib/dashboard-session";
import { entitlementsFor } from "@/lib/entitlements";

export const metadata: Metadata = { title: "הגדרות" };

export default async function SettingsPage() {
  const { business } = await requireBusiness();
  const canBrand = entitlementsFor(business).customBranding;

  return (
    <div>
      <header className="mb-5">
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900 dark:text-neutral-50">
          הגדרות
        </h1>
        <p className="mt-0.5 text-sm text-neutral-500">
          פרטי העסק וכללי קביעת התורים
        </p>
      </header>

      <SettingsForm
        business={{
          name: business.name,
          slug: business.slug,
          phone: business.phone ?? "",
          address: business.address ?? "",
          description: business.description ?? "",
          bufferMin: business.bufferMin,
          cancelWindowHours: business.cancelWindowHours,
          reminderHoursBefore: business.reminderHoursBefore,
          notificationEmail: business.notificationEmail ?? "",
          timezone: business.timezone,
        }}
      />

      <div className="mt-8">
        <h2 className="text-lg font-bold tracking-tight text-neutral-900 dark:text-neutral-50">
          עיצוב עמוד ההזמנות
        </h2>
        <p className="mt-0.5 mb-4 text-sm text-neutral-500">
          צבע, באנר, גלריה וחוות דעת
        </p>

        {canBrand ? (
          <AppearanceForm
            initial={{
              themeColor: toThemeColor(business.themeColor),
              heroMediaUrl: business.heroMediaUrl ?? "",
              heroMediaType:
                business.heroMediaType === "image" ||
                business.heroMediaType === "video"
                  ? (business.heroMediaType as HeroMediaType)
                  : "",
              galleryUrls: parseGallery(business.galleryUrls),
              reviews: parseReviews(business.reviews),
            }}
          />
        ) : (
          <BrandingUpsell />
        )}
      </div>
    </div>
  );
}

/**
 * Shown instead of the form rather than as a disabled copy of it. Rendering
 * thirty greyed-out controls an owner cannot use is worse than saying what the
 * feature is and what unlocks it.
 *
 * Anything already saved keeps rendering on the public page. Branding predates
 * this gate, so a tenant could have set it while it was free — pulling their
 * gallery down as a side effect of a repackaging would be hostile.
 */
function BrandingUpsell() {
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-6 text-center dark:border-neutral-800 dark:bg-neutral-900">
      <span className="inline-flex size-11 items-center justify-center rounded-full bg-teal-50 dark:bg-teal-950">
        <Sparkles
          className="size-5 text-teal-700 dark:text-teal-300"
          aria-hidden
        />
      </span>
      <h3 className="mt-3 font-semibold text-neutral-900 dark:text-neutral-100">
        עיצוב מותאם זמין במסלול המקצועי
      </h3>
      <p className="mx-auto mt-1 max-w-md text-sm leading-relaxed text-neutral-500">
        צבע מותאם, באנר, גלריית עבודות וחוות דעת של לקוחות — כדי שעמוד ההזמנות
        ייראה כמו העסק שלכם ולא כמו טופס.
      </p>
      {/* Points at the public pricing section until /dashboard/billing exists
          in stage 8c — a live control that 404s is worse than an extra hop. */}
      <Link
        href="/#pricing"
        className="mt-4 inline-flex h-11 items-center justify-center rounded-xl bg-teal-700 px-5 text-sm font-semibold text-white transition-colors hover:bg-teal-800 focus-visible:ring-2 focus-visible:ring-teal-700 focus-visible:ring-offset-2 focus-visible:outline-none"
      >
        השוואת מסלולים
      </Link>
    </div>
  );
}
