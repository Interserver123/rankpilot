import { defineCloudflareConfig } from "@opennextjs/cloudflare";

const config = defineCloudflareConfig();

// `npm run build` runs the OpenNext build, which itself needs to run the plain Next.js
// build. Pointing it at build:next avoids it re-invoking `npm run build` recursively.
export default { ...config, buildCommand: "npm run build:next" };
