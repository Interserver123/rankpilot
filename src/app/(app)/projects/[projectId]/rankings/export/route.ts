import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/server/auth";
import { projectRelation } from "@/server/relations";
import { canProject } from "@/lib/permissions";
import { sql } from "@/server/db";
import { getProject, keywordRankings } from "@/server/queries";
import { rateLimit } from "@/server/rate-limit";
import { toCsv } from "@/lib/keywords";
import { changeInfo, parseRankFilters, positionLabel, toObserved } from "@/lib/rank-display";

export async function GET(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const user = await getCurrentUser();
  if (!user || !/^[0-9a-f-]{36}$/i.test(projectId)) return new NextResponse("Not found", { status: 404 });
  const rel = await projectRelation(sql, user, projectId);
  if (!rel || !canProject(rel.relation, "project.view")) return new NextResponse("Not found", { status: 404 });
  if (!rateLimit(`export:${user.id}`, 10, 60_000).ok) return new NextResponse("Too many exports, try again shortly", { status: 429 });

  const project = (await getProject(sql, projectId))!;
  const f = parseRankFilters(Object.fromEntries(req.nextUrl.searchParams));
  const rows = await keywordRankings(sql, projectId, { ...f, page: 1, pageSize: 100_000 });
  const csv = toCsv(
    ["keyword", "location", "requested_location", "device", "language", "current_position", "previous_position", "change", "ranking_url", "serp_features", "collected_at_utc", "provider", "tags", "active"],
    rows.map((r) => {
      const cur = toObserved(r.cur_status, r.cur_pos, r.cur_depth);
      const prev = toObserved(r.prev_status, r.prev_pos, r.prev_depth);
      return [r.keyword, r.location_name, r.requested_location, r.device, r.language, positionLabel(cur), positionLabel(prev), changeInfo(cur, prev).text,
        r.ranking_url, (r.serp_features ?? []).join("; "), r.collected_at?.toISOString(), r.provider, r.tags.join("; "), r.is_active];
    }),
  );
  const name = `${project.domain}-rankings-${new Date().toISOString().slice(0, 10)}.csv`;
  return new NextResponse(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" } });
}
