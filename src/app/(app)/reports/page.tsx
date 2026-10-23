import { requireStaff } from "@/server/authz";
import { PlannedModule } from "@/components/ui";

export const metadata = { title: "Reports" };

export default async function Page() {
  await requireStaff();
  return <PlannedModule title="Reports" phase="Phase 7">Scheduled and on-demand client reports will appear here.</PlannedModule>;
}
