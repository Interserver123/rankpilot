import { requireStaff } from "@/server/authz";
import { PlannedModule } from "@/components/ui";

export const metadata = { title: "Alerts" };

export default async function Page() {
  await requireStaff();
  return <PlannedModule title="Alerts" phase="Phase 8">Ranking, budget and data-freshness alerts will appear here. Budget threshold warnings are already shown on the overview and usage pages.</PlannedModule>;
}
