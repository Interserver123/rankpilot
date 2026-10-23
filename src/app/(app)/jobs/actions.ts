"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStaff } from "@/server/authz";
import { sql } from "@/server/db";
import { approveJob, cancelJob } from "@/server/jobs/queue";
import { canOrg } from "@/lib/permissions";

export async function approveJobAction(jobId: string) {
  const user = await requireStaff("budget.approve");
  const ok = await approveJob(sql, z.string().uuid().parse(jobId), user.organizationId, user.id);
  revalidatePath("/jobs", "layout");
  return ok ? { ok: true } : { error: "Job is no longer awaiting approval." };
}

export async function cancelJobAction(jobId: string) {
  const user = await requireStaff();
  const id = z.string().uuid().parse(jobId);
  const [job] = await sql<{ project_id: string }[]>`select project_id from tracking_jobs where id = ${id} and organization_id = ${user.organizationId}`;
  if (!job) return { error: "Job not found." };
  if (user.role === "member") {
    const [a] = await sql`select 1 from project_assignments where project_id = ${job.project_id} and user_id = ${user.id}`;
    if (!a) return { error: "Job not found." };
  }
  if (!canOrg(user.role, "job.view")) return { error: "Not permitted." };
  const ok = await cancelJob(sql, id, user.organizationId, user.id);
  revalidatePath("/jobs", "layout");
  return ok ? { ok: true } : { error: "Only queued or waiting jobs can be cancelled." };
}
