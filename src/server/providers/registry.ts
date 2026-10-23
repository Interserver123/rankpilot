import type { SerpProvider } from "./types";
import { DataForSeoProvider } from "./serp/dataforseo";
import { YepApiProvider } from "./serp/yepapi";
import { MockSerpProvider } from "./serp/mock";

const serpProviders: SerpProvider[] = [new DataForSeoProvider(), new YepApiProvider(), new MockSerpProvider()];

export function listSerpProviders(): SerpProvider[] {
  return serpProviders;
}

export function getSerpProvider(id: string): SerpProvider | undefined {
  return serpProviders.find((p) => p.id === id);
}

/** Preferred configured SERP provider: a real provider wins over the mock. */
export function defaultSerpProvider(): SerpProvider | undefined {
  return serpProviders.find((p) => p.isConfigured());
}

/** Safe, credential-free description for the UI. */
export function describeProviders() {
  return serpProviders.map((p) => ({
    id: p.id,
    name: p.displayName,
    module: "organic" as const,
    configured: p.isConfigured(),
    capabilities: p.capabilities(),
    pricePerUnit: p.pricePerUnit(),
    currency: p.currency(),
    limits: p.limits(),
  }));
}
