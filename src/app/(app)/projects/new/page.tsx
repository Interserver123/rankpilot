import { requireStaff } from "@/server/authz";
import { defaultSerpProvider } from "@/server/providers/registry";
import { PageHeader } from "@/components/ui";
import { ProjectWizard } from "./wizard";

export const metadata = { title: "New project" };

export default async function NewProjectPage() {
  await requireStaff("project.create");
  const p = defaultSerpProvider();
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="New project" subtitle="Only the project details and one location are required. Everything else can be added later." />
      <ProjectWizard
        serpProvider={p ? { name: p.displayName, pricePerUnit: p.pricePerUnit(), currency: p.currency(), isMock: p.id === "mock" } : null}
        timezones={["UTC", ...Intl.supportedValuesOf("timeZone")]}
      />
    </div>
  );
}
