// Given DATABASE_URL, verify it connects; for Supabase pooler hosts also try the other
// aws-0/aws-1 cluster. Prints the working URL to stdout (nothing else); exits 1 if none work.
import postgres from "postgres";

const input = (process.env.DATABASE_URL || "").trim();
if (!input) process.exit(1);
const candidates = [input];
if (/aws-0-[a-z0-9-]+\.pooler\.supabase\.com/.test(input)) candidates.push(input.replace("aws-0-", "aws-1-"));
else if (/aws-1-[a-z0-9-]+\.pooler\.supabase\.com/.test(input)) candidates.push(input.replace("aws-1-", "aws-0-"));

for (const url of candidates) {
  const sql = postgres(url, { max: 1, ssl: "require", prepare: false, connect_timeout: 10, onnotice: () => {} });
  try {
    const [r] = await sql`select count(*)::int as n from schema_migrations`;
    console.error(`[db] ${new URL(url).hostname}: OK (${r.n} migrations)`);
    process.stdout.write(url);
    await sql.end();
    process.exit(0);
  } catch (e) {
    console.error(`[db] ${new URL(url).hostname}: ${e.code ?? ""} ${e.message}`);
    await sql.end({ timeout: 1 }).catch(() => {});
  }
}
process.exit(1);
