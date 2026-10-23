/**
 * Adaptive result depth for page-priced SERP providers.
 *
 * A keyword that ranked at position 3 last time almost always ranks near 3 again, so one page of
 * results answers the question for a tenth of the cost of a depth-100 check. Misses escalate to the
 * full depth, so a real drop is still measured, not guessed.
 */
export interface PrevObservation { status: "ranked" | "not_found"; position: number | null }

export type DepthReason = "baseline" | "near_last_rank" | "probe" | "periodic_full" | "competitor_floor";

export interface DepthPlan {
  depth: number;
  reason: DepthReason;
  /** On a miss, repeat once at the full depth. */
  escalate: boolean;
}

export interface DepthPlanOptions {
  maxDepth: number;
  pageSize: number;
  /** Depth of the very first check of a keyword. */
  baselineDepth: number;
  /** Depth used for keywords that were not found last time. */
  probeDepth: number;
  /** A keyword not found is re-checked at full depth at least this often. */
  fullCheckDays: number;
  /** Ranks beyond the previous position that the first request must cover. */
  bufferRanks: number;
  /** Minimum depth when competitors are tracked, so their positions stay comparable. */
  competitorFloor: number | null;
  now: Date;
}

export const DEFAULT_DEPTH_OPTIONS = { pageSize: 10, baselineDepth: 30, probeDepth: 30, fullCheckDays: 28, bufferRanks: 5 } as const;

const roundUp = (n: number, page: number) => Math.ceil(n / page) * page;

export function planDepth(prev: PrevObservation | null, lastFullDepthAt: Date | null, o: DepthPlanOptions): DepthPlan {
  const floor = o.competitorFloor ? Math.min(o.maxDepth, roundUp(o.competitorFloor, o.pageSize)) : 0;
  const withFloor = (plan: DepthPlan): DepthPlan =>
    plan.depth >= floor ? plan : { depth: floor, reason: "competitor_floor", escalate: plan.escalate && floor < o.maxDepth };
  if (!prev) return withFloor({ depth: Math.min(o.maxDepth, roundUp(o.baselineDepth, o.pageSize)), reason: "baseline", escalate: false });
  if (prev.status === "ranked" && prev.position !== null) {
    const depth = Math.min(o.maxDepth, roundUp(prev.position + o.bufferRanks, o.pageSize));
    return withFloor({ depth, reason: "near_last_rank", escalate: depth < o.maxDepth });
  }
  const ageMs = lastFullDepthAt ? o.now.getTime() - lastFullDepthAt.getTime() : Infinity;
  if (ageMs > o.fullCheckDays * 86_400_000) return { depth: o.maxDepth, reason: "periodic_full", escalate: false };
  return withFloor({ depth: Math.min(o.maxDepth, roundUp(o.probeDepth, o.pageSize)), reason: "probe", escalate: false });
}
