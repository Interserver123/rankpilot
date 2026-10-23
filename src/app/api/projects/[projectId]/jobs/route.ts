import { NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth";
import { projectRelation } from "@/server/relations";
import { canProject } from "@/lib/permissions";
import { sql } from "@/server/db";

export const dynamic = "force-dynamic";

/** Active jobs for a project, polled by the UI to show progress without blocking the page. */
export async function GET(_req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const user = await getCurrentUser();
  if (!user || !/^[0-9a-f-]{36}$/i.test(projectId)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const rel = await projectRelation(sql, user, projectId);
  if (!rel || !canProject(rel.relation, "job.view")) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const jobs = await sql<{ id: string; module: string; status: string; trigger: string; created_at: Date; total: number; done: number; failed: number }[]>`
    select j.id, j.module, j.status, j.trigger, j.created_at,
      count(t.id)::int as total,
      count(t.id) filter (where t.status = 'succeeded')::int as done,
      count(t.id) filter (where t.status in ('failed', 'uncertain'))::int as failed
    from tracking_jobs j left join tracking_job_targets t on t.job_id = j.id
    where j.project_id = ${projectId} and j.status in ('queued', 'running', 'awaiting_approval')
    group by j.id order by j.created_at`;
  return NextResponse.json({ jobs }, { headers: { "Cache-Control": "no-store" } });
}
