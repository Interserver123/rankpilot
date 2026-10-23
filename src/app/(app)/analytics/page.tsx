import { requireStaff } from "@/server/authz";
import { PlannedModule } from "@/components/ui";

export const metadata = { title: "Analytics" };

export default async function Page() {
  await requireStaff();
  return <PlannedModule title="Analytics" phase="Phase 4">Search Console and GA4 metrics across all projects will appear here.</PlannedModule>;
}
