import { requireProjectAccess } from "@/server/authz";
import { PlannedModule } from "@/components/ui";

export default async function Page({ params }: { params: Promise<{ projectId: string }> }) {
  await requireProjectAccess((await params).projectId, "project.view");
  return <PlannedModule icon="report" title="Reports" phase="Phase 7">Generate PDF and CSV reports with date ranges and data-source labels. Organic rankings can already be exported as CSV from the rankings tab.</PlannedModule>;
}
