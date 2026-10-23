/** Geo-grid helpers (Phase 3 Maps module). */

const EARTH_RADIUS_M = 6_371_008.8;

export interface GridPoint { row: number; col: number; lat: number; lng: number }

/**
 * Builds a rows×cols grid centred on (lat,lng) with `spacingMeters` between neighbours.
 * Row 0 is the northernmost row; col 0 the westernmost column.
 */
export function generateGrid(centerLat: number, centerLng: number, rows: number, cols: number, spacingMeters: number): GridPoint[] {
  if (!Number.isInteger(rows) || !Number.isInteger(cols) || rows < 1 || cols < 1) throw new Error("Grid dimensions must be positive integers");
  if (!(spacingMeters > 0)) throw new Error("Spacing must be positive");
  if (Math.abs(centerLat) > 85) throw new Error("Latitude too close to the poles for a grid");
  const latStep = (spacingMeters / EARTH_RADIUS_M) * (180 / Math.PI);
  const points: GridPoint[] = [];
  for (let r = 0; r < rows; r++) {
    const lat = centerLat + ((rows - 1) / 2 - r) * latStep;
    // Longitude degrees shrink with latitude; use each row's own latitude.
    const lngStep = latStep / Math.cos((lat * Math.PI) / 180);
    for (let c = 0; c < cols; c++) {
      let lng = centerLng + (c - (cols - 1) / 2) * lngStep;
      if (lng > 180) lng -= 360;
      if (lng < -180) lng += 360;
      points.push({ row: r, col: c, lat: round6(lat), lng: round6(lng) });
    }
  }
  return points;
}

function round6(n: number) { return Math.round(n * 1e6) / 1e6; }

export type PointResult =
  | { status: "ranked"; position: number }
  | { status: "not_found" }
  | { status: "failed" };

export interface GridMetrics {
  resultDepth: number;
  totalPoints: number;
  validPoints: number;
  failedPoints: number;
  /** Average over ranked points only; null if none ranked. */
  averagePosition: number | null;
  top3Pct: number | null;
  top10Pct: number | null;
  notFoundPct: number | null;
}

/** Failed points are excluded from every percentage and average (never counted as rank 0). */
export function gridMetrics(results: PointResult[], resultDepth: number): GridMetrics {
  const valid = results.filter((r) => r.status !== "failed");
  const ranked = valid.flatMap((r) => (r.status === "ranked" ? [r.position] : []));
  const pct = (n: number) => (valid.length ? Math.round((n / valid.length) * 1000) / 10 : null);
  return {
    resultDepth,
    totalPoints: results.length,
    validPoints: valid.length,
    failedPoints: results.length - valid.length,
    averagePosition: ranked.length ? Math.round((ranked.reduce((a, b) => a + b, 0) / ranked.length) * 10) / 10 : null,
    top3Pct: pct(ranked.filter((p) => p <= 3).length),
    top10Pct: pct(ranked.filter((p) => p <= 10).length),
    notFoundPct: pct(valid.filter((r) => r.status === "not_found").length),
  };
}
