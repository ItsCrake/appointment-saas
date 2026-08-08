import { Globe, MessageCircle } from "lucide-react";

import type { SocialLink, SocialPlatform } from "@/lib/social-links";

/**
 * The brand marks are inline SVG because **lucide dropped its brand icon set**
 * — `Instagram` and `Facebook` no longer exist in the package at v1.28.
 *
 * Pinning them here rather than adding an icon dependency is the better trade
 * for three marks: a brand logo has to stay recognisable, and tracking it to
 * somebody else's release cadence is how it silently disappears again.
 */
function InstagramIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      <rect width="20" height="20" x="2" y="2" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="0.5" fill="currentColor" />
    </svg>
  );
}
function FacebookIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden {...props}>
      <path d="M22 12.06C22 6.5 17.52 2 12 2S2 6.5 2 12.06c0 5.02 3.66 9.18 8.44 9.94v-7.03H7.9v-2.9h2.54V9.85c0-2.52 1.5-3.91 3.77-3.91 1.09 0 2.24.2 2.24.2v2.46h-1.26c-1.24 0-1.63.78-1.63 1.57v1.89h2.78l-.45 2.9h-2.33V22c4.78-.76 8.44-4.92 8.44-9.94Z" />
    </svg>
  );
}

function TiktokIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden {...props}>
      <path d="M16.5 2h-2.9v13.2a2.5 2.5 0 1 1-2-2.45V9.8a5.5 5.5 0 1 0 5 5.47V8.9a6.3 6.3 0 0 0 3.6 1.13V7.1a3.6 3.6 0 0 1-3.6-3.6V2Z" />
    </svg>
  );
}

const ICONS: Record<
  SocialPlatform,
  (props: React.SVGProps<SVGSVGElement>) => React.ReactNode
> = {
  instagram: InstagramIcon,
  facebook: FacebookIcon,
  tiktok: TiktokIcon,
  // A chat bubble rather than the WhatsApp mark: lucide has no brand glyph,
  // and an approximate logo is worse than an honest generic one.
  whatsapp: (props) => <MessageCircle {...props} />,
  website: (props) => <Globe {...props} />,
};

/**
 * The tenant's social profiles, in the public header.
 *
 * Renders nothing at all when nothing is configured — no empty row, no
 * placeholder — which is what keeps a shop that only wants a booking page from
 * carrying a strip of dead space.
 *
 * `rel="noopener noreferrer"` on every link: these are owner-supplied
 * destinations, and `target="_blank"` without `noopener` hands the opened page
 * a handle back to this one.
 */
export function SocialRow({ links }: { links: SocialLink[] }) {
  if (links.length === 0) return null;

  return (
    <ul className="mt-3 flex flex-wrap items-center gap-2">
      {links.map((link) => {
        const Icon = ICONS[link.platform];
        return (
          <li key={link.platform}>
            <a
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={link.label}
              title={link.label}
              className="flex size-9 items-center justify-center rounded-full border border-zinc-200 text-zinc-600 transition-colors hover:border-(--accent) hover:text-(--accent-on-soft) focus-visible:ring-2 focus-visible:ring-(--accent) focus-visible:outline-none dark:border-zinc-700 dark:text-zinc-300"
            >
              <Icon className="size-4" />
            </a>
          </li>
        );
      })}
    </ul>
  );
}
