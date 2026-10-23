import { requireStaff } from "@/server/authz";
import { describeProviders } from "@/server/providers/registry";
import { formatMoney } from "@/lib/cost";
import { Badge, Card, PageHeader } from "@/components/ui";

export const metadata = { title: "Integrations" };

export default async function IntegrationsPage() {
  await requireStaff();
  const providers = describeProviders();
  const planned = [
    { name: "Google Search Console", phase: "Phase 4", note: "OAuth 2.0 with the read-only webmasters scope; property selected per project." },
    { name: "Google Analytics 4", phase: "Phase 4", note: "OAuth 2.0 with the analytics read-only scope; GA4 Data API." },
    { name: "Maps rank provider", phase: "Phase 3", note: "Requires a provider proven to return Google Maps results at grid coordinates." },
    { name: "LLM providers", phase: "Phase 5", note: "Each result will be labelled with its source and collection method." },
    { name: "Citation sources", phase: "Phase 6", note: "Discovery and permitted page verification." },
  ];
  return (
    <div className="space-y-6">
      <PageHeader title="Integrations" subtitle="Provider credentials live in server environment variables and are never sent to the browser." />
      <Card title="SERP data providers">
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
              {!p.configured && p.id === "dataforseo" && <p className="mt-3 text-xs text-faint">Set DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD on the server, then restart the app and worker.</p>}
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
