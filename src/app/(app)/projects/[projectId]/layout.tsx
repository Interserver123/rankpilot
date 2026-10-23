import { notFound } from "next/navigation";
import { requireProjectAccess } from "@/server/authz";
import { sql } from "@/server/db";
import { getProject } from "@/server/queries";
import { Badge } from "@/components/ui";
import { ProjectTabs } from "@/components/project-tabs";
import { ActiveJobs } from "@/components/active-jobs";
import { Icon } from "@/components/icons";

export default async function ProjectLayout({ children, params }: { children: React.ReactNode; params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  await requireProjectAccess(projectId, "project.view");
  const project = await getProject(sql, projectId);
  if (!project) notFound();
  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-4">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-navy font-display text-lg font-bold uppercase text-accent shadow-sm">{project.name.slice(0, 2)}</span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-display text-2xl font-semibold tracking-tight">{project.name}</h1>
            <Badge tone={project.status === "active" ? "good" : project.status === "paused" ? "warn" : "neutral"}><span className="capitalize">{project.status}</span></Badge>
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
            <a className="inline-flex items-center gap-1 font-medium text-accent hover:underline" href={`https://${project.domain}`} target="_blank" rel="noreferrer noopener">{project.domain}<Icon name="up" size={12} /></a>
            <span>{project.client_name}</span>
            {project.business_category && <span>· {project.business_category}</span>}
            <span className="inline-flex items-center gap-1 text-faint"><Icon name="clock" size={13} />{project.timezone}</span>
          </div>
        </div>
      </div>
      <ProjectTabs projectId={projectId} />
      <ActiveJobs projectId={projectId} />
      <div className="mt-6">{children}</div>
    </div>
  );
}
