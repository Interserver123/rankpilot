import { requireStaff } from "@/server/authz";
import { PlannedModule } from "@/components/ui";

export const metadata = { title: "Citations" };

export default async function Page() {
  await requireStaff();
  return <PlannedModule icon="citation" title="Citations" phase="Phase 6">Citation consistency across all projects will appear here.</PlannedModule>;
}
