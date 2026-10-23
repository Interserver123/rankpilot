import type { SetupProblem } from "@/server/schema";

const STEPS: Record<SetupProblem["kind"], string[]> = {
  no_database_url: [
    "Create a PostgreSQL database (Supabase, Neon or any Postgres 15+).",
    "Add its connection string as the DATABASE_URL secret for this deployment (Cloudflare: Workers → Settings → Variables and Secrets).",
    "Redeploy. Tables are created automatically on the next visit.",
  ],
  cannot_connect: [
    "Check that DATABASE_URL is the full connection string, including user, password, host, port and database name.",
    "On Cloudflare Workers, put Hyperdrive in front of the database, or use a host that accepts direct TCP connections.",
    "Make sure the database allows connections from the internet (or from Cloudflare).",
  ],
  schema: ["Tables could not be created automatically. Run `npm run migrate` with DATABASE_URL set, then reload this page."],
  unknown: ["Check the deployment logs for the full error, then reload this page."],
};

export function SetupNotice({ problem }: { problem: SetupProblem }) {
  return (
    <div className="space-y-4">
      <div role="alert" className="rounded-xl border border-warn/30 bg-warn/10 p-4 text-sm text-warn">{problem.detail}</div>
      <ol className="list-inside list-decimal space-y-2 text-sm text-muted">
        {STEPS[problem.kind].map((s) => <li key={s}>{s}</li>)}
      </ol>
      <a href="/sign-in" className="btn-secondary w-full">Check again</a>
    </div>
  );
}
