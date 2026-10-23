"use client";

import { useParams, useRouter } from "next/navigation";
import { Icon } from "./icons";

export function ProjectSwitcher({ projects }: { projects: { id: string; name: string; domain: string }[] }) {
  const router = useRouter();
  const params = useParams<{ projectId?: string }>();
  return (
    <label className="relative flex items-center">
      <span className="pointer-events-none absolute left-3 text-accent"><Icon name="projects" size={16} /></span>
      <select aria-label="Switch project" className="input max-w-64 appearance-none pl-9 pr-8 font-medium"
        value={params.projectId ?? ""} onChange={(e) => router.push(e.target.value ? `/projects/${e.target.value}` : "/projects")}>
        <option value="">All projects</option>
        {projects.map((p) => <option key={p.id} value={p.id}>{p.name} — {p.domain}</option>)}
      </select>
      <span className="pointer-events-none absolute right-3 text-faint">▾</span>
    </label>
  );
}
