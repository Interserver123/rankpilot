import { requireStaff } from "@/server/authz";
import { PlannedModule } from "@/components/ui";

export const metadata = { title: "AI Visibility" };

export default async function Page() {
  await requireStaff();
  return <PlannedModule icon="ai" title="AI Visibility" phase="Phase 5">AI search visibility across all projects will appear here.</PlannedModule>;
}
