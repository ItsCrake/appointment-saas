import type { Metadata } from "next";
import { Heebo } from "next/font/google";
import "./globals.css";

// Heebo ships both Hebrew and Latin glyphs — required for an RTL-first UI.
const heebo = Heebo({
  variable: "--font-heebo",
  subsets: ["hebrew", "latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Appointment SaaS",
  description: "Online appointment scheduling for small businesses",
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
