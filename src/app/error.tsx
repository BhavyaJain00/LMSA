"use client";

import { useEffect } from "react";
import { Button, ButtonLink } from "@/components/ui/button";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
      <p className="text-sm font-semibold uppercase tracking-wider text-danger">Something went wrong</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink">We hit an unexpected error</h1>
      <p className="mt-2 max-w-md text-sm text-ink-muted">{error.message || "Please try again."}</p>
      <div className="mt-6 flex gap-2">
        <Button onClick={reset}>Try again</Button>
        <ButtonLink href="/" variant="outline">
          Go home
        </ButtonLink>
      </div>
    </div>
  );
}
