import { PageSkeleton } from "@/components/dashboard/page-skeleton";

export default function Loading() {
  // Five aggregates in parallel, so this is the one dashboard page where the
  // wait is genuinely visible.
  return <PageSkeleton rows={4} height="h-36" />;
}
