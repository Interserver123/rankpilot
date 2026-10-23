import { requireProjectAccess } from "@/server/authz";
import { PlannedModule } from "@/components/ui";

export default async function Page({ params }: { params: Promise<{ projectId: string }> }) {
  await requireProjectAccess((await params).projectId, "project.view");
  return <PlannedModule title="Search Console" phase="Phase 4">Connect a Search Console property via OAuth to see clicks, impressions, CTR and average position. GSC average position is shown separately from tracked rankings.</PlannedModule>;
}
