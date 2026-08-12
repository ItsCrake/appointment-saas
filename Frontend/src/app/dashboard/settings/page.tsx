import type { Metadata } from "next";
import Link from "next/link";
import { Sparkles } from "lucide-react";

import { AppearanceForm } from "@/components/dashboard/appearance-form";
import {
  DepositSettingsForm,
  LogoForm,
  SocialLinksForm,
} from "@/components/dashboard/profile-extras-form";
import { PushSettings } from "@/components/dashboard/push-settings";
import {
  SettingsDirtyProvider,
  SettingsSaveBar,
} from "@/components/dashboard/settings-dirty";
import { SettingsForm } from "@/components/dashboard/settings-form";
import { btnAccent } from "@/components/dashboard/ui";
import {
  parseGallery,
  parseReviews,
  toThemeColor,
  type HeroMediaType,
} from "@/lib/branding";
import { requireBusiness } from "@/lib/dashboard-session";
import { entitlementsFor } from "@/lib/entitlements";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "הגדרות" };

export default async function SettingsPage() {
  const { business } = await requireBusiness();
  const canBrand = entitlementsFor(business).customBranding;

  return (
    // Every section below registers its dirty state here, and the bar is the
    // only save control on the page. pb-28 keeps the last card clear of it.
    <SettingsDirtyProvider>
      <div className="pb-28">
        <header className="mb-5">
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            הגדרות
          </h1>
          <p className="mt-0.5 text-sm text-zinc-500">
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
            requiresApproval: business.requiresApproval,
            retentionEnabled: business.retentionEnabled,
          }}
          canUseRetention={entitlementsFor(business).clientRetention}
        />

        {/* Above the branding block on purpose: the logo is not part of what the
          Pro tier sells, and putting it inside a section a free tenant sees as
          an upsell would hide a field they are entitled to use. */}
        <div className="mt-8">
          <h2 className="text-lg font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            לוגו העסק
          </h2>
          <p className="mt-0.5 mb-4 text-sm text-zinc-500">
            התמונה שמזהה את העסק בעמוד ההזמנות
          </p>

          <LogoForm initial={business.logoUrl} />
        </div>

        <div className="mt-8">
          <h2 className="text-lg font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            עיצוב עמוד ההזמנות
          </h2>
          <p className="mt-0.5 mb-4 text-sm text-zinc-500">
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

        <div className="mt-8">
          <h2 className="text-lg font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            התראות למכשיר
          </h2>
          <p className="mt-0.5 mb-4 text-sm text-zinc-500">
            התראה מיידית על תור חדש, גם כשהאפליקציה סגורה
          </p>

          {/* Outside the save bar: granting browser permission is not a form
              field, and an owner who has just accepted a permission prompt has
              already made the decision — asking them to press Save as well
              would leave notifications off for anyone who forgets. */}
          <PushSettings enabled={business.pushEnabled} />
        </div>

        <div className="mt-8">
          <h2 className="text-lg font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            רשתות חברתיות
          </h2>
          <p className="mt-0.5 mb-4 text-sm text-zinc-500">
            קישורים שיופיעו בעמוד ההזמנות
          </p>

          <SocialLinksForm
            initial={{
              instagram: business.socialInstagram ?? "",
              facebook: business.socialFacebook ?? "",
              tiktok: business.socialTiktok ?? "",
              whatsapp: business.socialWhatsapp ?? "",
              website: business.websiteUrl ?? "",
            }}
          />
        </div>

        <div className="mt-8">
          <h2 className="text-lg font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            מקדמה
          </h2>
          <p className="mt-0.5 mb-4 text-sm text-zinc-500">
            תשלום מראש לשריון התור
          </p>

          <DepositSettingsForm
            initial={{
              enabled: business.depositEnabled,
              mode: business.depositMode === "gateway" ? "gateway" : "manual",
              // The column is agorot; the form speaks shekels.
              amount: Math.round(business.depositAmountCents / 100),
              bitPhone: business.depositBitPhone ?? "",
              paymentUrl: business.depositPaymentUrl ?? "",
              instructions: business.depositInstructions ?? "",
            }}
          />
        </div>
      </div>

      <SettingsSaveBar />
    </SettingsDirtyProvider>
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
    <div className="rounded-2xl border border-zinc-200 bg-white p-6 text-center dark:border-zinc-800 dark:bg-zinc-900">
      {/* An upgrade prompt is the one thing on this screen being recommended
          rather than offered, so it carries the gradient — the same rule the
          featured tier follows on `/`. */}
      <span className="inline-flex size-11 items-center justify-center rounded-full bg-[image:var(--brand-gradient)]">
        <Sparkles className="size-5 text-white" aria-hidden />
      </span>
      <h3 className="mt-3 font-semibold text-zinc-900 dark:text-zinc-100">
        עיצוב מותאם זמין במסלול המקצועי
      </h3>
      <p className="mx-auto mt-1 max-w-md text-sm leading-relaxed text-zinc-500">
        צבע מותאם, באנר, גלריית עבודות וחוות דעת של לקוחות — כדי שעמוד ההזמנות
        ייראה כמו העסק שלכם ולא כמו טופס.
      </p>
      <Link href="/dashboard/billing" className={cn(btnAccent, "mt-4")}>
        פרטי המסלול
      </Link>
    </div>
  );
}
