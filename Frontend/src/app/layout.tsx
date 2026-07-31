import type { Metadata, Viewport } from "next";
import { Heebo } from "next/font/google";
import "./globals.css";

// Heebo ships both Hebrew and Latin glyphs — required for an RTL-first UI.
const heebo = Heebo({
  variable: "--font-heebo",
  subsets: ["hebrew", "latin"],
  display: "swap",
});

/** Absolute base for OG/canonical URLs — relative ones break link previews. */
const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(appUrl),
  title: {
    default: "זימון תורים אונליין",
    template: "%s · זימון תורים",
  },
  description:
    "קביעת תורים אונליין לעסקים קטנים — עמוד הזמנות מהיר ללקוחות וניהול יומן פשוט לבעל העסק.",
  applicationName: "זימון תורים",
  formatDetection: { telephone: true },
  openGraph: {
    type: "website",
    locale: "he_IL",
    siteName: "זימון תורים",
  },
  twitter: { card: "summary" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Booking pages are content, not an app shell — let people zoom.
  maximumScale: 5,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="he"
      dir="rtl"
      className={`${heebo.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col font-sans">{children}</body>
    </html>
  );
}
