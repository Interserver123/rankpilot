/** Normalizes user input like "https://www.Example.com/path" to "example.com". */
export function normalizeDomain(input: string): string {
  let s = input.trim().toLowerCase();
  if (!s) return "";
  if (!/^[a-z][a-z0-9+.-]*:\/\//.test(s)) s = `http://${s}`;
  try {
    const host = new URL(s).hostname;
    return host.replace(/^www\./, "").replace(/\.$/, "");
  } catch {
    return "";
  }
}

export function isValidDomain(input: string): boolean {
  const d = normalizeDomain(input);
  return /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,62}$/.test(d);
}

/** True when `url` belongs to `domain` or one of its subdomains. */
export function urlMatchesDomain(url: string, domain: string): boolean {
  const host = normalizeDomain(url);
  const target = normalizeDomain(domain);
  if (!host || !target) return false;
  return host === target || host.endsWith(`.${target}`);
}
