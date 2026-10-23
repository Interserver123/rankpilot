import { closeSql, getSql } from "../src/server/db";
import { runWorkerLoop } from "../src/server/jobs/worker";

const controller = new AbortController();
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    console.log(`received ${sig}, finishing current pass…`);
    controller.abort();
  });
}

runWorkerLoop(getSql(), {
  pollMs: Number(process.env.WORKER_POLL_INTERVAL_MS ?? 5000),
  schedulerMs: Number(process.env.WORKER_SCHEDULER_INTERVAL_MS ?? 60000),
  signal: controller.signal,
})
  .then(closeSql)
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
