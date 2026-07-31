import { headers } from "next/headers";

/**
 * Best-effort client IP for rate limiting.
 *
 * These headers are only trustworthy because Vercel sets them and strips
 * client-supplied copies. Behind a different proxy they are spoofable, which
 * is exactly why IP limiting is the secondary layer here and the phone-number
 * rule carries the real weight.
 */
export async function getClientIp(): Promise<string> {
  const headerList = await headers();

  const forwarded = headerList.get("x-forwarded-for");
  if (forwarded) {
    // Left-most entry is the original client; the rest are proxy hops.
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }

  return (
    headerList.get("x-real-ip")?.trim() ||
    headerList.get("x-vercel-forwarded-for")?.trim() ||
    // Local dev, or a host that forwards nothing. Shared bucket by design.
    "unknown"
  );
}
