import { PageSkeleton } from "@/components/layout/page-skeleton";

export default function MatterDetailLoading() {
  // Renders inside the matter layout's content slot, under the real
  // header and tabs — so no second (fake) TopBar.
  return <PageSkeleton variant="detail" withTopBar={false} />;
}
