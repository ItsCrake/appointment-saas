import type { Metadata } from "next";

import { AppearanceForm } from "@/components/dashboard/appearance-form";
import { SettingsForm } from "@/components/dashboard/settings-form";
import {
  parseGallery,
  parseReviews,
  toThemeColor,
  type HeroMediaType,
} from "@/lib/branding";
import { requireBusiness } from "@/lib/dashboard-session";

export const metadata: Metadata = { title: "הגדרות" };

export default async function SettingsPage() {
  const { business } = await requireBusiness();

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
      </div>
    </div>
  );
}
