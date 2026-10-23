// Runs before `wrangler deploy` / `wrangler dev` (see "build" in wrangler.jsonc), so a plain
// `npx wrangler deploy` — e.g. Cloudflare Workers Builds' default deploy command — always ships a
// fresh OpenNext bundle. `npm run deploy`/`preview` build first and set the skip flag.
import { spawnSync } from "node:child_process";

if (process.env.RANKPILOT_SKIP_CF_BUILD === "1") {
  console.log("[cf-build] using existing .open-next build");
  process.exit(0);
}
const r = spawnSync("npx", ["opennextjs-cloudflare", "build"], { stdio: "inherit", shell: process.platform === "win32" });
process.exit(r.status ?? 1);
