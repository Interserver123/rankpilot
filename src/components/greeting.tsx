"use client";

import { useEffect, useState } from "react";

/** Time-of-day greeting computed in the viewer's own time zone. */
export function Greeting({ name }: { name: string }) {
  const [part, setPart] = useState<string | null>(null);
  useEffect(() => {
    const h = new Date().getHours();
    setPart(h < 5 ? "Working late" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening");
  }, []);
  return (
    <h1 className="font-display text-3xl font-semibold tracking-tight md:text-[34px]">
      {part ?? "Welcome back"}, <span className="capitalize text-accent">{name}</span>
    </h1>
  );
}
