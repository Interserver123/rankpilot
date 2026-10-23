"use client";

import { startTransition, type FormEvent } from "react";

/**
 * React 19 resets uncontrolled form fields after an action submit. For forms that may return a
 * validation error, submit manually so the user's input is kept.
 */
export function keepValuesOnSubmit(action: (fd: FormData) => void) {
  return (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(() => action(fd));
  };
}
