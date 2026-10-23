// `npm run build` picks the right build for where it runs:
//  - Vercel (VERCEL=1): plain Next.js build, served as normal Node functions.
//  - Anywhere else (e.g. Cloudflare Workers Builds): OpenNext bundle for Workers.
import { spawnSync } from "node:child_process";

const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { stdio: "inherit", shell: process.platform === "win32" });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

run("npx", ["tsx", "scripts/bundle-migrations.ts"]);
if (process.env.VERCEL || process.env.RANKPILOT_TARGET === "node") {
  console.log("[build] Node target (Next.js)");
  run("npx", ["next", "build"]);
} else {
  console.log("[build] Cloudflare Workers target (OpenNext)");
  run("npx", ["opennextjs-cloudflare", "build"]);
}
