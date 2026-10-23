import type { RankFilters } from "@/server/queries";
import { formatRankChange, rankChange, changeDirection, type ObservedRank } from "./ranking";

export function toObserved(status: "ranked" | "not_found" | null, position: number | null, depth: number | null): ObservedRank | null {
  if (status === "ranked" && position !== null) return { status: "ranked", position };
  if (status === "not_found") return { status: "not_found", depth: depth ?? 0 };
  return null;
}

export function positionLabel(o: ObservedRank | null): string {
  if (!o) return "—";
  return o.status === "ranked" ? String(o.position) : `Not in top ${o.depth}`;
}

export interface TrackingStatusInput {
  isActive: boolean; collectedAt: Date | null; lastTargetStatus: string | null; lastTargetAt: Date | null; lastTargetError: string | null;
}

export function trackingStatus(r: TrackingStatusInput): { label: string; tone: "good" | "warn" | "bad" | "info" | "neutral"; detail?: string } {
  if (!r.isActive) return { label: "Paused", tone: "neutral" };
  if (r.lastTargetStatus === "pending" || r.lastTargetStatus === "in_flight") return { label: "Checking", tone: "info" };
  const failedAfterData = r.lastTargetAt && (!r.collectedAt || r.lastTargetAt > r.collectedAt);
  if ((r.lastTargetStatus === "failed" || r.lastTargetStatus === "uncertain") && failedAfterData) {
    return { label: r.lastTargetStatus === "uncertain" ? "Outcome unknown" : "Last check failed", tone: "bad", detail: r.lastTargetError ?? undefined };
  }
  if (!r.collectedAt) return { label: "Awaiting first check", tone: "neutral" };
  return { label: "Tracking", tone: "good" };
}

export function changeInfo(cur: ObservedRank | null, prev: ObservedRank | null) {
  const c = rankChange(cur, prev);
  return { text: formatRankChange(c), direction: changeDirection(c) };
}

export type RankSearchParams = { q?: string; tag?: string; location?: string; device?: string; sort?: string; dir?: string; page?: string };

export function parseRankFilters(sp: RankSearchParams): RankFilters {
  return {
    q: sp.q || undefined, tag: sp.tag || undefined,
    locationId: /^[0-9a-f-]{36}$/.test(sp.location ?? "") ? sp.location : undefined,
    device: sp.device === "desktop" || sp.device === "mobile" ? sp.device : undefined,
    sort: (["keyword", "position", "change", "checked"] as const).find((s) => s === sp.sort),
    dir: sp.dir === "desc" ? "desc" : "asc",
    page: Number(sp.page) || 1,
  };
}

