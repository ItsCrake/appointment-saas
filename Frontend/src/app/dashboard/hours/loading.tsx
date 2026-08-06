import { PageSkeleton } from "@/components/dashboard/page-skeleton";

/** Seven weekday rows, so the swap lands on the same grid. */
export default function Loading() {
  return <PageSkeleton rows={7} height="h-16" />;
}
