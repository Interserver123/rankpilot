/**
 * Ranking calculations. Inputs are verified observations only: a failed collection is not an
 * observation and must never reach these functions as a position.
 */

export type ObservedRank =
  | { status: "ranked"; position: number }
  | { status: "not_found"; depth: number };

export type RankChange =
  | { kind: "no_data" }
  | { kind: "new" } // first observation
  | { kind: "entered"; to: number } // was not found, now ranked
  | { kind: "dropped_out"; from: number } // was ranked, now not found
  | { kind: "still_not_found" }
  | { kind: "moved"; from: number; to: number; delta: number }; // delta > 0 = improved

export function rankChange(current: ObservedRank | null, previous: ObservedRank | null): RankChange {
  if (!current) return { kind: "no_data" };
  if (!previous) return { kind: "new" };
  if (current.status === "ranked" && previous.status === "ranked") {
    return { kind: "moved", from: previous.position, to: current.position, delta: previous.position - current.position };
  }
  if (current.status === "ranked") return { kind: "entered", to: current.position };
  if (previous.status === "ranked") return { kind: "dropped_out", from: previous.position };
  return { kind: "still_not_found" };
}

export function formatRankChange(c: RankChange): string {
  switch (c.kind) {
    case "no_data": return "—";
    case "new": return "New";
    case "entered": return "Entered";
    case "dropped_out": return "Lost";
    case "still_not_found": return "—";
    case "moved": return c.delta === 0 ? "0" : c.delta > 0 ? `▲ ${c.delta}` : `▼ ${Math.abs(c.delta)}`;
  }
}

/** +1 improved, -1 declined, 0 unchanged/unknown. */
export function changeDirection(c: RankChange): -1 | 0 | 1 {
  if (c.kind === "entered") return 1;
  if (c.kind === "dropped_out") return -1;
  if (c.kind === "moved") return c.delta > 0 ? 1 : c.delta < 0 ? -1 : 0;
  return 0;
}

export const DISTRIBUTION_BUCKETS = [
  { key: "top3", label: "1–3", max: 3 },
  { key: "top10", label: "4–10", max: 10 },
  { key: "top20", label: "11–20", max: 20 },
  { key: "top50", label: "21–50", max: 50 },
  { key: "top100", label: "51–100", max: 100 },
] as const;

export interface Distribution {
  buckets: Record<(typeof DISTRIBUTION_BUCKETS)[number]["key"] | "beyond" | "notFound", number>;
  /** Keywords with a verified observation. Keywords without data are excluded and counted separately. */
  measured: number;
  noData: number;
}

export function rankDistribution(ranks: (ObservedRank | null)[]): Distribution {
  const buckets = { top3: 0, top10: 0, top20: 0, top50: 0, top100: 0, beyond: 0, notFound: 0 };
  let measured = 0;
  let noData = 0;
  for (const r of ranks) {
    if (!r) { noData++; continue; }
    measured++;
    if (r.status === "not_found") { buckets.notFound++; continue; }
    const b = DISTRIBUTION_BUCKETS.find((x) => r.position <= x.max);
    if (b) buckets[b.key]++;
    else buckets.beyond++;
  }
  return { buckets, measured, noData };
}

/**
 * Average position over ranked keywords only. Not-found and missing keywords are excluded
 * (and must be reported alongside the average), never counted as 0 or as depth+1.
 */
export function averagePosition(ranks: (ObservedRank | null)[]): { average: number | null; counted: number } {
  const positions = ranks.flatMap((r) => (r && r.status === "ranked" ? [r.position] : []));
  if (positions.length === 0) return { average: null, counted: 0 };
  const avg = positions.reduce((a, b) => a + b, 0) / positions.length;
  return { average: Math.round(avg * 10) / 10, counted: positions.length };
}
