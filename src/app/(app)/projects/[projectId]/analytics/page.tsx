import { requireProjectAccess } from "@/server/authz";
import { PlannedModule } from "@/components/ui";

export default async function Page({ params }: { params: Promise<{ projectId: string }> }) {
  await requireProjectAccess((await params).projectId, "project.view");
  return <PlannedModule icon="analytics" title="Google Analytics" phase="Phase 4">Connect a GA4 property via OAuth to see organic sessions, engagement and key events.</PlannedModule>;
}
