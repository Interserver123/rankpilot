import { requireProjectAccess } from "@/server/authz";
import { PlannedModule } from "@/components/ui";

export default async function Page({ params }: { params: Promise<{ projectId: string }> }) {
  await requireProjectAccess((await params).projectId, "project.view");
  return <PlannedModule title="Maps Grid" phase="Phase 3">Configure geo-grids around each business location and render ranking heatmaps. Failed grid points will be shown separately from verified absences.</PlannedModule>;
}
