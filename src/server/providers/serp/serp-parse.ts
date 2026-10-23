import { urlMatchesDomain } from "@/lib/domain";

export interface OrganicItem {
  position: number;
  url: string;
  title: string | null;
}

/** Finds the best (lowest) organic position for a domain. Null = not in the provided results. */
export function findDomainPosition(items: OrganicItem[], domain: string): OrganicItem | null {
  let best: OrganicItem | null = null;
  for (const it of items) {
    if (urlMatchesDomain(it.url, domain) && (!best || it.position < best.position)) best = it;
  }
  return best;
}
