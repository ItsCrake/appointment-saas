import type { Metadata } from "next";

import { LegalPage } from "@/components/marketing/legal-page";
import { PRIVACY_SECTIONS } from "@/lib/legal-content";

export const metadata: Metadata = {
  title: "מדיניות פרטיות",
  description: "איזה מידע נאסף, למה, למי הוא נמסר וכיצד מוחקים אותו.",
  alternates: { canonical: "/legal/privacy" },
};

export default function PrivacyPage() {
  return (
    <LegalPage
      title="מדיניות פרטיות"
      intro="מה נאסף, לשם מה, כמה זמן הוא נשמר, ואילו זכויות עומדות לכם ביחס אליו."
      sections={PRIVACY_SECTIONS}
    />
  );
}
