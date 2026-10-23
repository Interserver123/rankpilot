import { DateTime } from "luxon";

export function formatDateTime(d: Date | string | null | undefined, timezone = "UTC"): string {
  if (!d) return "—";
  const dt = DateTime.fromJSDate(typeof d === "string" ? new Date(d) : d).setZone(timezone);
  return dt.isValid ? dt.toFormat("d LLL yyyy, HH:mm ZZZZ") : "—";
}

export function formatDate(d: Date | string | null | undefined, timezone = "UTC"): string {
  if (!d) return "—";
  return DateTime.fromJSDate(typeof d === "string" ? new Date(d) : d).setZone(timezone).toFormat("d LLL yyyy");
}

export function relativeTime(d: Date | string | null | undefined, now = new Date()): string {
  if (!d) return "never";
  const date = typeof d === "string" ? new Date(d) : d;
  const s = Math.round((date.getTime() - now.getTime()) / 1000);
  const abs = Math.abs(s);
  const [v, unit] =
    abs < 60 ? [s, "second"] : abs < 3600 ? [Math.round(s / 60), "minute"] : abs < 86400 ? [Math.round(s / 3600), "hour"] : [Math.round(s / 86400), "day"];
  return new Intl.RelativeTimeFormat("en", { numeric: "auto" }).format(v, unit as Intl.RelativeTimeFormatUnit);
}

export function formatNumber(n: number | null | undefined): string {
  return n === null || n === undefined ? "—" : new Intl.NumberFormat("en-US").format(n);
}

export function describeLocation(l: { city?: string | null; region?: string | null; country_code: string; latitude?: number | null; longitude?: number | null }): string {
  if (l.latitude != null && l.longitude != null) return `${l.latitude.toFixed(4)}, ${l.longitude.toFixed(4)}`;
  return [l.city, l.region, l.country_code].filter(Boolean).join(", ");
}
