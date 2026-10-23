import { requireProjectAccess } from "@/server/authz";
import { PlannedModule } from "@/components/ui";

export default async function Page({ params }: { params: Promise<{ projectId: string }> }) {
  await requireProjectAccess((await params).projectId, "project.view");
  return <PlannedModule icon="ai" title="AI Visibility" phase="Phase 5">Track whether AI search experiences mention or cite this business for your prompts, with the raw response kept for every result.</PlannedModule>;
}
