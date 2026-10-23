import { z } from "zod";
import { isValidDomain, normalizeDomain } from "./domain";
import { isValidTimezone } from "./schedule";

const optionalText = (max: number) =>
  z.string().trim().max(max).optional().transform((v) => (v ? v : undefined));

export const locationSchema = z.object({
  name: z.string().trim().min(1, "Location name is required").max(120),
  businessName: optionalText(200),
  address: optionalText(300),
  phone: optionalText(40),
  countryCode: z.string().trim().length(2, "Use a 2-letter country code").transform((v) => v.toUpperCase()),
  region: optionalText(100),
  city: optionalText(100),
  postalCode: optionalText(20),
  latitude: z.coerce.number().min(-90).max(90).optional().or(z.literal("").transform(() => undefined)),
  longitude: z.coerce.number().min(-180).max(180).optional().or(z.literal("").transform(() => undefined)),
  googleDomain: z.string().trim().regex(/^google\.[a-z.]{2,10}$/, "e.g. google.com or google.co.uk").default("google.com"),
  googleBusinessProfileReference: optionalText(500),
}).refine((l) => (l.latitude === undefined) === (l.longitude === undefined), {
  message: "Provide both latitude and longitude, or neither",
  path: ["latitude"],
});
export type LocationInput = z.infer<typeof locationSchema>;

export const competitorSchema = z.object({
  name: z.string().trim().min(1).max(200),
  domain: z.string().trim().max(253).optional()
    .refine((d) => !d || isValidDomain(d), "Invalid domain")
    .transform((d) => (d ? normalizeDomain(d) : undefined)),
});

export const scheduleSchema = z.object({
  enabled: z.boolean(),
  intervalValue: z.coerce.number().int().min(1).max(365),
  intervalUnit: z.enum(["day", "week", "month"]),
  preferredRunTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM (24h)"),
});
export type ScheduleInput = z.infer<typeof scheduleSchema>;

export const MODULES = ["organic", "maps", "llm", "citations"] as const;
export type TrackedModule = (typeof MODULES)[number];

export const keywordInputSchema = z.object({
  keyword: z.string().trim().min(1).max(200),
  locationId: z.string().uuid(),
  device: z.enum(["desktop", "mobile"]),
  language: z.string().trim().min(2).max(10),
  targetUrl: z.string().trim().url().max(2000).optional().or(z.literal("").transform(() => undefined)),
  tags: z.array(z.string()).max(20).default([]),
});

export const projectWizardSchema = z.object({
  project: z.object({
    name: z.string().trim().min(1, "Project name is required").max(120),
    domain: z.string().trim().refine(isValidDomain, "Enter a valid domain, e.g. example.com").transform(normalizeDomain),
    clientName: z.string().trim().min(1, "Client or business name is required").max(200),
    businessCategory: z.string().trim().min(1, "Business category is required").max(120),
    country: z.string().trim().length(2).transform((v) => v.toUpperCase()),
    language: z.string().trim().min(2).max(10),
    timezone: z.string().refine(isValidTimezone, "Unknown time zone"),
    notes: optionalText(5000),
  }),
  locations: z.array(locationSchema).min(1, "Add at least one location").max(50),
  competitors: z.array(competitorSchema).max(20).default([]),
  keywords: z.array(z.object({
    keyword: z.string().trim().min(1).max(200),
    /** Index into `locations`. */
    locationIndex: z.number().int().min(0),
    device: z.enum(["desktop", "mobile"]),
    targetUrl: z.string().trim().url().optional().or(z.literal("").transform(() => undefined)),
    tags: z.array(z.string()).max(20).default([]),
  })).max(5000).default([]),
  schedules: z.object({
    organic: scheduleSchema,
    maps: scheduleSchema,
    llm: scheduleSchema,
    citations: scheduleSchema,
  }),
  activate: z.boolean().default(true),
});
export type ProjectWizardInput = z.input<typeof projectWizardSchema>;
export type ProjectWizardData = z.output<typeof projectWizardSchema>;
