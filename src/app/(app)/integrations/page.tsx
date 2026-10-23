import { randomBytes } from "node:crypto";
import { requireStaff } from "@/server/authz";
import { canOrg } from "@/lib/permissions";
import { defaultSerpProvider, describeProviders } from "@/server/providers/registry";
import { PROVIDER_SPECS, credentialStatus, encryptionConfigured } from "@/server/providers/credentials";
import Link from "next/link";
import { sql } from "@/server/db";
import { KeyForm } from "./key-form";
import { formatMoney } from "@/lib/cost";
import { Badge, Card, PageHeader } from "@/components/ui";

export const metadata = { title: "Integrations" };

export default async function IntegrationsPage() {
  const user = await requireStaff();
  const canSave = canOrg(user.role, "integration.manage");
  const providers = describeProviders();
  const active = defaultSerpProvider();
  const hasEncryptionKey = encryptionConfigured();
  const [{ n: budgets } = { n: 0 }] = await sql<{ n: number }[]>`select count(*)::int as n from budgets where organization_id = ${user.organizationId}`;
  const steps = [
    { done: hasEncryptionKey, title: "Add APP_ENCRYPTION_KEY", body: "Vercel → Settings → Environment Variables. Any random 32+ character value, then redeploy. Keep a copy: if it changes, saved keys must be re-entered." },
    { done: Boolean(active), title: "Add and test a provider key", body: "Paste the key into YepAPI or DataForSEO below → Save → Test connection. YepAPI keys: yepapi.com/dashboard/api-keys." },
    { done: budgets > 0, title: "Set a monthly budget", body: "Usage & Costs → Budgets, before adding many keywords. Blocks or asks approval when spend would pass the limit.", href: "/usage", cta: "Open Usage & Costs" },
  ];
  const planned = [
    { name: "Google Search Console", phase: "Phase 4", note: "OAuth 2.0 with the read-only webmasters scope; property selected per project." },
    { name: "Google Analytics 4", phase: "Phase 4", note: "OAuth 2.0 with the analytics read-only scope; GA4 Data API." },
    { name: "Maps rank provider", phase: "Phase 3", note: "Requires a provider proven to return Google Maps results at grid coordinates." },
    { name: "LLM providers", phase: "Phase 5", note: "Each result will be labelled with its source and collection method." },
    { name: "Citation sources", phase: "Phase 6", note: "Discovery and permitted page verification." },
  ];
  return (
    <div className="space-y-6">
      <PageHeader title="Integrations" subtitle="API keys are encrypted on the server and never sent back to the browser. A key saved here overrides a server environment variable." />
      <Card title="Setup guide">
        <ol className="space-y-3 text-sm">
          {steps.map((st, i) => (
            <li key={st.title} className="flex gap-3">
              <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${st.done ? "bg-good/15 text-good" : "bg-panel-2 text-muted"}`}>{st.done ? "✓" : i + 1}</span>
              <div>
                <div className="font-medium">{st.title} {st.done && <Badge tone="good">Done</Badge>}</div>
                <p className="text-muted">{st.body}</p>
                {!st.done && st.href && <Link href={st.href} className="mt-1 inline-block text-accent underline">{st.cta}</Link>}
              </div>
            </li>
          ))}
        </ol>
      </Card>
      {canSave && !hasEncryptionKey && (
        <div className="rounded-xl border border-warn/40 bg-warn/10 p-4 text-sm">
          <div className="font-semibold">One-time setup before you can save keys</div>
          <p className="mt-1 text-muted">Add an environment variable named <code>APP_ENCRYPTION_KEY</code> on your host (Vercel → Settings → Environment Variables), then redeploy. Use this value, and keep a copy; if it is lost or changed, saved keys must be re-entered:</p>
          <code className="mt-2 block break-all rounded-lg bg-panel px-2 py-1 font-mono text-xs">{randomBytes(32).toString("hex")}</code>
        </div>
      )}
      {!canSave && <p className="text-sm text-muted">Only administrators can add or change API keys.</p>}
      <Card title="SERP data providers">
        <p className="mb-4 text-sm text-muted">{active ? <>Rankings are collected with <span className="font-medium text-text">{active.displayName}</span>. If several providers are connected, the first one listed is used.</> : "No provider is connected yet. Add a key below to start collecting rankings."}</p>
        <div className="grid gap-4 md:grid-cols-2">
          {providers.map((p) => (
            <div key={p.id} className="rounded-lg border border-line bg-panel-2 p-4 text-sm">
              <div className="flex items-center justify-between"><span className="font-medium">{p.name}</span>{p.configured ? <Badge tone="good">Connected</Badge> : <Badge>Not connected</Badge>}</div>
              <ul className="mt-3 space-y-1 text-muted">
                <li>Devices: {p.capabilities.devices.join(", ")}</li>
                <li>Targeting: {p.capabilities.locationTargeting.join(", ")}</li>
                <li>Max depth: {p.capabilities.maxDepth}</li>
                <li>Price per request: {p.pricePerUnit === null ? "not configured (estimates shown as unknown)" : formatMoney(p.pricePerUnit, p.currency)}</li>
                {p.capabilities.limitations.map((l) => <li key={l} className="text-faint">• {l}</li>)}
              </ul>
              {(() => {
                const spec = PROVIDER_SPECS.find((x) => x.id === p.id);
                if (!spec) return null;
                const st = credentialStatus(p.id);
                return (
                  <>
                    <p className="mt-3 text-xs text-faint">
                      Keys: {st.source === "dashboard" ? "saved in the dashboard" : st.source === "environment" ? "from server environment variables" : "not set"}. Get them at {spec.dashboardHint}.
                    </p>
                    {st.unreadable && <p className="mt-2 text-xs text-bad">Saved keys could not be decrypted (APP_ENCRYPTION_KEY changed?). Enter them again.</p>}
                    {hasEncryptionKey || !canSave
                      ? <KeyForm providerId={p.id} canSave={canSave && hasEncryptionKey} hasSaved={st.updatedAt !== null} fields={spec.fields.map((f) => ({ ...st.fields.find((x) => x.key === f.key)!, label: f.label, placeholder: f.placeholder, help: f.help }))} />
                      : <p className="mt-3 text-xs text-faint">Finish the one-time setup above to add keys here.</p>}
                  </>
                );
              })()}
            </div>
          ))}
        </div>
      </Card>
      <Card title="Planned integrations">
        <ul className="space-y-3 text-sm">
          {planned.map((p) => <li key={p.name} className="flex flex-wrap items-center gap-2"><span className="font-medium">{p.name}</span><Badge tone="info">{p.phase}</Badge><span className="text-muted">{p.note}</span></li>)}
        </ul>
      </Card>
    </div>
  );
}
