import type { Metadata } from "next";

import { LegalPage } from "@/components/marketing/legal-page";
import { TERMS_SECTIONS } from "@/lib/legal-content";

export const metadata: Metadata = {
  title: "תנאי שימוש",
  description: "תנאי השימוש, המנוי, ההחזרים והתקשורת בשירות.",
  alternates: { canonical: "/legal/terms" },
};

export default function TermsPage() {
  return (
    <LegalPage
      title="תנאי שימוש"
      intro="התנאים שלהלן חלים על השימוש בשירות, על המנוי ועל ההודעות שהמערכת שולחת."
      sections={TERMS_SECTIONS}
    />
  );
}
