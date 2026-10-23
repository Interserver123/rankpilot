import { providerValue } from "./credentials";
import { YEPAPI_BALANCE_ENDPOINT } from "./serp/yepapi";

export interface ConnectionTest { ok: boolean; message: string }

async function timedFetch(url: string, init: RequestInit): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(15_000) });
}

/** Free credential checks only: no search is run and nothing is billed. */
export async function testProviderConnection(providerId: string): Promise<ConnectionTest> {
  try {
    if (providerId === "yepapi") {
      const key = providerValue("yepapi", "apiKey");
      if (!key) return { ok: false, message: "No API key saved yet." };
      const res = await timedFetch(YEPAPI_BALANCE_ENDPOINT, { headers: { "x-api-key": key } });
      const j = (await res.json().catch(() => null)) as { ok?: boolean; data?: { balanceUsd?: number | string }; error?: { code?: string; message?: string } } | null;
      if (j?.ok) return { ok: true, message: j.data?.balanceUsd !== undefined ? `Key works. Balance: $${Number(j.data.balanceUsd).toFixed(2)}.` : "Key works." };
      return { ok: false, message: j?.error?.message ?? `YepAPI rejected the request (HTTP ${res.status}).` };
    }
    if (providerId === "dataforseo") {
      const login = providerValue("dataforseo", "login");
      const password = providerValue("dataforseo", "password");
      if (!login || !password) return { ok: false, message: "Login and password are both needed." };
      const res = await timedFetch("https://api.dataforseo.com/v3/appendix/user_data", {
        headers: { Authorization: `Basic ${Buffer.from(`${login}:${password}`).toString("base64")}` },
      });
      const j = (await res.json().catch(() => null)) as { status_code?: number; status_message?: string; tasks?: { result?: { money?: { balance?: number } }[] }[] } | null;
      if (res.ok && j?.status_code === 20000) {
        const bal = j.tasks?.[0]?.result?.[0]?.money?.balance;
        return { ok: true, message: typeof bal === "number" ? `Login works. Balance: $${bal.toFixed(2)}.` : "Login works." };
      }
      return { ok: false, message: j?.status_message ?? `DataForSEO rejected the login (HTTP ${res.status}).` };
    }
    return { ok: false, message: "This provider has no connection test." };
  } catch (e) {
    return { ok: false, message: e instanceof Error && e.name === "TimeoutError" ? "The provider did not answer in 15 seconds." : "Could not reach the provider." };
  }
}
