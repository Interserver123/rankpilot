import { requireStaff } from "@/server/authz";
import { PlannedModule } from "@/components/ui";

export const metadata = { title: "Maps Grid" };

export default async function Page() {
  await requireStaff();
  return <PlannedModule title="Maps Grid" phase="Phase 3">Geo-grid rank tracking across all projects will appear here.</PlannedModule>;
}
