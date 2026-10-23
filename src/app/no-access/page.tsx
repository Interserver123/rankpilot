export const dynamic = "force-dynamic";

import { authIdentity } from "@/server/auth";

export default async function NoAccess() {
  const user = await authIdentity();
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="card max-w-md p-6 text-sm">
        <h1 className="mb-2 text-lg font-semibold">No workspace access</h1>
        <p className="text-muted">
          {user ? `${user.email} is signed in but is not a member of an agency workspace.` : "You are not signed in."} Ask an administrator to add you.
          Client dashboards will be available in a later release.
        </p>
        <form action="/auth/sign-out" method="post" className="mt-4"><button className="btn-secondary">Sign out</button></form>
      </div>
    </main>
  );
}
