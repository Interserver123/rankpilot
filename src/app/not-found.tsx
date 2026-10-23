import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-[60vh] items-center justify-center p-4">
      <div className="text-center">
        <h1 className="text-lg font-semibold">Not found</h1>
        <p className="mt-1 text-sm text-muted">This page doesn&apos;t exist or you don&apos;t have access to it.</p>
        <Link href="/" className="btn-secondary mt-4">Back to overview</Link>
      </div>
    </main>
  );
}
