import { requireProjectAccess } from "@/server/authz";
import { PlannedModule } from "@/components/ui";

export default async function Page({ params }: { params: Promise<{ projectId: string }> }) {
  await requireProjectAccess((await params).projectId, "project.view");
  return <PlannedModule icon="citation" title="Citations" phase="Phase 6">Track directory listings and compare their name, address and phone against this project's business record.</PlannedModule>;
}
