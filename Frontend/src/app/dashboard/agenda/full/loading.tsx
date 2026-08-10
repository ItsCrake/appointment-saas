import { PageSkeleton } from "@/components/dashboard/page-skeleton";

export default function Loading() {
  // One tall block: the calendar is a single grid, so a stack of card-shaped
  // skeletons would promise a layout that never arrives.
  return <PageSkeleton rows={1} height="h-[32rem]" />;
}
