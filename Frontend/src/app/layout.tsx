import type { Metadata, Viewport } from "next";
import { Heebo } from "next/font/google";

import { CookieBanner } from "@/components/ui/cookie-banner";
import { BRAND } from "@/lib/brand";

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
    default: BRAND.title,
    template: `%s · ${BRAND.name}`,
  },
  description: BRAND.tagline,
  applicationName: BRAND.name,
  formatDetection: { telephone: true },
  openGraph: {
    type: "website",
    locale: "he_IL",
    siteName: BRAND.name,
  },
  twitter: { card: "summary" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Booking pages are content, not an app shell — let people zoom.
  maximumScale: 5,
  /**
   * **This is what makes `env(safe-area-inset-*)` non-zero on iOS.**
   *
   * Without it the viewport is `auto` (equivalent to `contain`), the page is
   * laid out inside the safe area, and every one of those variables resolves to
   * `0px`. The codebase had five `pb-[env(safe-area-inset-bottom)]` rules — on
   * the dashboard's bottom bar, the hours drawer, the more sheet, the gallery
   * lightbox and the week-calendar sheet — and all five were silently no-ops,
   * which is why the installed app's tab bar sat under the home indicator
   * despite looking correctly written.
   *
   * The consequence is that content now extends into the unsafe areas by
   * default, so anything fixed to an edge has to inset itself. `globals.css`
   * handles the status bar for the installed app; the bottom bar handles its
   * own edge.
   */
  viewportFit: "cover",
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
      <body className="flex min-h-full flex-col font-sans">
        {children}
        {/* Mounted at the root so it reaches every surface, including the
            tenant booking pages, which are the ones a member of the public
            actually lands on. A client leaf that renders nothing until after
            hydration, so it does not affect the static prerender of `/`.

            **`<AccessibilityWidget />` is deliberately unmounted for now.** The
            floating button sits over every page at every breakpoint, and while
            the product is still being built it was competing with the thing
            being looked at. The component and `/accessibility` — the statement
            itself, which is a legal obligation and is linked from the footer —
            are both untouched, so restoring it is this one line. */}
        <CookieBanner />
      </body>
    </html>
  );
}
