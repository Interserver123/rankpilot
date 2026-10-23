import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";

/**
 * Applies supabase/migrations/*.sql in order, recording each in schema_migrations.
 * On Supabase you can use `supabase db push` instead; both use the same files.
 */
export async function migrate(databaseUrl: string, log = console.log) {
  const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });
  try {
    await sql`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`;
    const dir = path.join(process.cwd(), "supabase", "migrations");
    const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
    const applied = new Set((await sql<{ name: string }[]>`select name from schema_migrations`).map((r) => r.name));
    for (const f of files) {
      if (applied.has(f)) continue;
      const body = await readFile(path.join(dir, f), "utf8");
      await sql.begin(async (tx) => {
        await tx.unsafe(body);
        await tx`insert into schema_migrations (name) values (${f})`;
      });
      log(`applied ${f}`);
    }
  } finally {
    await sql.end();
  }
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error("DATABASE_URL is not set"); process.exit(1); }
  migrate(url).then(() => console.log("migrations complete"), (e) => { console.error(e); process.exit(1); });
}
