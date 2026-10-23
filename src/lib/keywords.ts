import Papa from "papaparse";

export type Device = "desktop" | "mobile";
export const DEVICES: Device[] = ["desktop", "mobile"];
export const MAX_KEYWORD_LENGTH = 200;
export const MAX_IMPORT_ROWS = 5000;

export function normalizeKeyword(k: string): string {
  return k.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

export function normalizeTags(tags: string[]): string[] {
  const out = new Set<string>();
  for (const t of tags) {
    const n = t.trim().toLowerCase().replace(/\s+/g, "-").slice(0, 40);
    if (n) out.add(n);
  }
  return [...out];
}

export interface KeywordConfig {
  keyword: string;
  locationId: string;
  searchEngine: string;
  language: string;
  device: Device;
}

/**
 * Two configurations are duplicates only if the normalized keyword AND location, engine,
 * language and device all match. Same keyword at another location is a separate config.
 */
export function keywordConfigKey(c: KeywordConfig): string {
  return [normalizeKeyword(c.keyword), c.locationId, c.searchEngine, c.language.toLowerCase(), c.device].join("|");
}

export function dedupeKeywordConfigs<T extends KeywordConfig>(items: T[]): { unique: T[]; duplicates: T[] } {
  const seen = new Set<string>();
  const unique: T[] = [];
  const duplicates: T[] = [];
  for (const item of items) {
    const key = keywordConfigKey(item);
    if (seen.has(key)) duplicates.push(item);
    else { seen.add(key); unique.push(item); }
  }
  return { unique, duplicates };
}

export interface KeywordImportRow {
  keyword: string;
  location?: string;
  device?: Device;
  language?: string;
  targetUrl?: string;
  tags: string[];
}

export interface ImportError { row: number; message: string }

/**
 * Parses CSV with a header row. Recognized columns (case-insensitive):
 * keyword (required), location, device, language, target_url, tags (separated by ; or |).
 * A file with no recognized header is treated as one keyword per line.
 */
export function parseKeywordCsv(text: string): { rows: KeywordImportRow[]; errors: ImportError[] } {
  const errors: ImportError[] = [];
  const rows: KeywordImportRow[] = [];
  const trimmed = text.replace(/^﻿/, "").trim();
  if (!trimmed) return { rows, errors };

  const parsed = Papa.parse<string[]>(trimmed, { skipEmptyLines: true });
  const data = parsed.data;
  const header = (data[0] ?? []).map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
  const hasHeader = header.includes("keyword");
  const col = (name: string) => header.indexOf(name);
  const start = hasHeader ? 1 : 0;

  if (data.length - start > MAX_IMPORT_ROWS) {
    errors.push({ row: 0, message: `Too many rows (max ${MAX_IMPORT_ROWS}).` });
    return { rows, errors };
  }

  for (let i = start; i < data.length; i++) {
    const r = data[i] ?? [];
    const rowNum = i + 1;
    const get = (name: string) => (hasHeader && col(name) >= 0 ? (r[col(name)] ?? "").trim() : "");
    const keyword = (hasHeader ? get("keyword") : (r[0] ?? "")).trim();
    if (!keyword) { errors.push({ row: rowNum, message: "Missing keyword" }); continue; }
    if (keyword.length > MAX_KEYWORD_LENGTH) { errors.push({ row: rowNum, message: "Keyword too long" }); continue; }
    if (/[\u0000-\u001f]/.test(keyword)) { errors.push({ row: rowNum, message: "Keyword contains control characters" }); continue; }

    const deviceRaw = get("device").toLowerCase();
    let device: Device | undefined;
    if (deviceRaw) {
      if (deviceRaw !== "desktop" && deviceRaw !== "mobile") {
        errors.push({ row: rowNum, message: `Unsupported device "${deviceRaw}"` });
        continue;
      }
      device = deviceRaw;
    }
    const targetUrl = get("target_url");
    if (targetUrl && !/^https?:\/\/\S+$/i.test(targetUrl)) {
      errors.push({ row: rowNum, message: "Target URL must start with http:// or https://" });
      continue;
    }
    rows.push({
      keyword,
      location: get("location") || undefined,
      device,
      language: get("language") || undefined,
      targetUrl: targetUrl || undefined,
      tags: normalizeTags(get("tags").split(/[;|]/)),
    });
  }
  return { rows, errors };
}

/** Escapes a CSV cell, neutralizing spreadsheet formula injection. */
export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  return [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
