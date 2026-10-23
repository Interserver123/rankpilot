"use client";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const denied = error.message.startsWith("Not permitted");
  return (
    <div className="card mx-auto mt-10 max-w-lg p-6 text-sm">
      <h2 className="mb-2 text-lg font-semibold">{denied ? "You don't have permission to do that" : "Something went wrong"}</h2>
      <p className="text-muted">{denied ? "Ask an administrator if you need access." : "The error has been logged. Try again, and contact support if it continues."}</p>
      {error.digest && <p className="mt-2 text-xs text-faint">Reference: {error.digest}</p>}
      <button className="btn-secondary mt-4" onClick={reset}>Try again</button>
    </div>
  );
}
