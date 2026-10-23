"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { projectWizardSchema, type ProjectWizardInput } from "@/lib/validation";
import { requireStaff } from "@/server/authz";
import { sql } from "@/server/db";
import { createProject } from "@/server/services/projects";

export async function createProjectAction(input: ProjectWizardInput): Promise<{ error?: string; fieldErrors?: string[] }> {
  const user = await requireStaff("project.create");
  const parsed = projectWizardSchema.safeParse(input);
  if (!parsed.success) {
    return { error: "Please fix the highlighted problems.", fieldErrors: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) };
  }
  const { projectId } = await createProject(sql, { id: user.id, organizationId: user.organizationId }, parsed.data);
  revalidatePath("/projects");
  redirect(`/projects/${projectId}?created=1`);
}
