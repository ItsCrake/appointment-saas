import type { Metadata } from "next";

import { LegalPage } from "@/components/marketing/legal-page";
import { ACCESSIBILITY_SECTIONS } from "@/lib/legal-content";

export const metadata: Metadata = {
  title: "הצהרת נגישות",
  description: "רמת הנגישות של השירות, מה הותאם, מגבלות ידועות ודרכי פנייה.",
  alternates: { canonical: "/accessibility" },
};

export default function AccessibilityPage() {
  return (
    <LegalPage
      title="הצהרת נגישות"
      intro="אנו פועלים להתאים את השירות לתקן הישראלי ת״י 5568 ברמה AA."
      sections={ACCESSIBILITY_SECTIONS}
    />
  );
}
