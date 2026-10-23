import { requireProjectAccess } from "@/server/authz";
import { sql } from "@/server/db";
import { auditTrail, getProject, getTrackingConfigs } from "@/server/queries";
import { RUNNABLE_MODULES } from "@/server/jobs/scheduler";
import { canProject } from "@/lib/permissions";
import { formatDateTime, relativeTime } from "@/lib/format";
import { Card } from "@/components/ui";
import { ScheduleForm } from "./schedule-form";

const LABELS: Record<string, string> = { organic: "Organic SERP rankings", maps: "Google Maps geo-grid scans", llm: "LLM visibility checks", citations: "Citation verification" };

export default async function SchedulePage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const { relation } = await requireProjectAccess(projectId, "project.view");
  const project = (await getProject(sql, projectId))!;
  const configs = (await getTrackingConfigs(sql, projectId)).filter((c) => c.module in LABELS)
    .sort((a, b) => Object.keys(LABELS).indexOf(a.module) - Object.keys(LABELS).indexOf(b.module));
  const history = await auditTrail(sql, "tracking_config", configs.map((c) => c.id), 30);
  const canEdit = canProject(relation, "schedule.update");

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted">
        Each module runs on its own schedule in {project.timezone}. Manual refreshes never change these schedules.
        Provider rate limits and budgets are enforced regardless of frequency.
      </p>
      {configs.map((c) => (
        <Card key={c.id} title={LABELS[c.module]}
          footer={<span className="flex flex-wrap gap-x-4">
            <span>Last run: {c.last_run_at ? formatDateTime(c.last_run_at, project.timezone) : "never"}</span>
            <span>Last success: {relativeTime(c.last_success_at)}</span>
            <span>Next run: {c.enabled && c.next_run_at ? formatDateTime(c.next_run_at, project.timezone) : "not scheduled"}</span>
            {!RUNNABLE_MODULES.has(c.module) && <span className="text-warn">Collector not available yet; scheduled runs are skipped.</span>}
          </span>}>
          <ScheduleForm projectId={projectId} module={c.module} disabled={!canEdit}
            initial={{ enabled: c.enabled, intervalValue: c.interval_value, intervalUnit: c.interval_unit, preferredRunTime: c.preferred_run_time }} />
        </Card>
      ))}
      <Card title="Schedule change log">
        {history.length === 0 ? <p className="text-sm text-muted">No changes yet.</p> : (
          <ul className="space-y-2 text-sm">
            {history.map((h) => {
              const m = h.metadata_json as { module?: string; before?: Record<string, unknown>; after?: Record<string, unknown>; missed_slots?: number };
              return (
                <li key={h.id} className="flex flex-wrap justify-between gap-2">
                  <span>
                    {h.action === "schedule.missed" ? `Missed ${m.missed_slots} scheduled run(s); one recovery run was queued`
                      : `${LABELS[m.module ?? ""] ?? m.module}: ${JSON.stringify(m.before)} → ${JSON.stringify(m.after)}`}
                  </span>
                  <span className="text-muted">{h.actor_email ?? "system"} · {formatDateTime(h.created_at, project.timezone)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
