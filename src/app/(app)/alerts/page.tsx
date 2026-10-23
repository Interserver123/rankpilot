import { requireStaff, visibleProjectsFilter } from "@/server/authz";
import { sql } from "@/server/db";
import { actionItems } from "@/server/insights";
import { canOrg } from "@/lib/permissions";
import { ActionList } from "@/components/dashboard";
import { PageHeader } from "@/components/ui";

export const metadata = { title: "Action Center" };

export default async function AlertsPage() {
  const user = await requireStaff();
  const items = await actionItems(sql, visibleProjectsFilter(sql, user), user.organizationId, { includeBudgets: canOrg(user.role, "budget.manage") });
  const groups = [
    { key: "critical", title: "Fix now", hint: "Blocking data collection or spending money" },
    { key: "warning", title: "Needs attention soon", hint: "Delays, approvals and budget thresholds" },
    { key: "info", title: "Opportunities", hint: "Setup gaps that make tracking more useful" },
  ] as const;
  return (
    <div className="max-w-5xl">
      <PageHeader title="Action center" subtitle="A prioritized to-do list computed from your live jobs, budgets and tracking data. Email and ranking-change alerts arrive in a later phase." />
      <div className="grid gap-6 md:grid-cols-3">
        {groups.map((g) => {
          const list = items.filter((i) => i.severity === g.key);
          return (
            <section key={g.key}>
              <div className="mb-3">
                <h2 className="font-display text-lg font-semibold">{g.title} <span className="text-faint">· {list.length}</span></h2>
                <p className="text-xs text-muted">{g.hint}</p>
              </div>
              <ActionList items={list} empty="Nothing here." />
            </section>
          );
        })}
      </div>
    </div>
  );
}
