import { notFound } from "next/navigation";
import { requireProjectAccess } from "@/server/authz";
import { sql } from "@/server/db";
import { getProject } from "@/server/queries";
import { Badge } from "@/components/ui";
import { ProjectTabs } from "@/components/project-tabs";
import { ActiveJobs } from "@/components/active-jobs";

export default async function ProjectLayout({ children, params }: { children: React.ReactNode; params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  await requireProjectAccess(projectId, "project.view");
  const project = await getProject(sql, projectId);
  if (!project) notFound();
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold tracking-tight">{project.name}</h1>
        <a className="text-sm text-muted hover:underline" href={`https://${project.domain}`} target="_blank" rel="noreferrer noopener">{project.domain} ↗</a>
        <Badge tone={project.status === "active" ? "good" : project.status === "paused" ? "warn" : "neutral"}>{project.status}</Badge>
        <span className="text-xs text-faint">{project.client_name} · {project.timezone}</span>
      </div>
      <ProjectTabs projectId={projectId} />
      <ActiveJobs projectId={projectId} />
      <div className="mt-6">{children}</div>
    </div>
  );
}
