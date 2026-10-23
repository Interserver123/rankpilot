/**
 * Usage/cost estimation. Estimates are only converted to money when a configured unit price
 * exists; otherwise `amount` is null and the UI shows "unknown" rather than a guess.
 */

export interface UnitPrice {
  /** Price per provider billing unit, or null if not configured/known. */
  pricePerUnit: number | null;
  currency: string;
}

export interface Estimate {
  units: number;
  amount: number | null;
  currency: string;
}

function money(units: number, price: UnitPrice): Estimate {
  return {
    units,
    amount: price.pricePerUnit === null ? null : Math.round(units * price.pricePerUnit * 10000) / 10000,
    currency: price.currency,
  };
}

/** Organic: keyword configurations × provider units per request. */
export function estimateOrganic(keywordConfigs: number, unitsPerRequest: number, price: UnitPrice): Estimate {
  return money(keywordConfigs * unitsPerRequest, price);
}

/** Maps: rows × columns × keywords × provider-specific request factor. */
export function estimateMaps(rows: number, cols: number, keywords: number, requestFactor: number, price: UnitPrice): Estimate {
  return money(rows * cols * keywords * requestFactor, price);
}

/** LLM: active prompts × providers × runs per prompt. */
export function estimateLlm(prompts: number, providers: number, runsPerPrompt: number, price: UnitPrice): Estimate {
  return money(prompts * providers * runsPerPrompt, price);
}

/** Citations: discovery and verification are estimated separately. */
export function estimateCitations(
  discoveryQueries: number, verifications: number,
  discoveryPrice: UnitPrice, verificationPrice: UnitPrice,
): { discovery: Estimate; verification: Estimate } {
  return { discovery: money(discoveryQueries, discoveryPrice), verification: money(verifications, verificationPrice) };
}

export interface BudgetState {
  limit: number;
  spent: number;
  alertThresholdPct: number;
}

export type BudgetDecision =
  | { allowed: true; warning: boolean; projectedPct: number }
  | { allowed: false; reason: "limit_reached" | "would_exceed"; projectedPct: number };

/**
 * Decides whether a job with an `estimate` may proceed. An unknown estimate (null) is allowed
 * only while spend is below the limit, because its cost cannot be checked in advance.
 */
export function checkBudget(b: BudgetState, estimate: number | null): BudgetDecision {
  const projected = b.spent + (estimate ?? 0);
  const projectedPct = b.limit > 0 ? (projected / b.limit) * 100 : projected > 0 ? Infinity : 0;
  if (b.spent >= b.limit) return { allowed: false, reason: "limit_reached", projectedPct };
  if (projected > b.limit) return { allowed: false, reason: "would_exceed", projectedPct };
  return { allowed: true, warning: projectedPct >= b.alertThresholdPct, projectedPct };
}

export function formatMoney(amount: number | null | undefined, currency = "USD"): string {
  if (amount === null || amount === undefined) return "unknown";
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: amount < 1 ? 4 : 2 }).format(amount);
}
