import { PageSkeleton } from "@/components/dashboard/page-skeleton";

/** Subscription card, then the plan picker's two tiers. */
export default function Loading() {
  return <PageSkeleton rows={3} height="h-40" />;
}
