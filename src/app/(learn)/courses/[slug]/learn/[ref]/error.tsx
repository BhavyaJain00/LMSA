"use client";

import { useParams } from "next/navigation";
import { useEffect } from "react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";

export default function LessonError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const params = useParams<{ slug: string }>();
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-20 text-center">
      <span className="flex size-14 items-center justify-center rounded-full bg-danger/10 text-danger">
        <Icon.AlertTriangle className="size-7" />
      </span>
      <h1 className="mt-4 text-xl font-semibold tracking-tight text-ink">This lesson could not be displayed</h1>
      <p className="mt-2 max-w-md text-sm text-ink-muted">Something went wrong while loading it. Reload the page, and tell your instructor if it keeps happening.</p>
      {error.digest && <p className="mt-2 font-mono text-xs text-ink-faint">Reference: {error.digest}</p>}
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <Button onClick={reset} leftIcon={<Icon.Refresh className="size-4" />}>
          Try again
        </Button>
        <ButtonLink href={params?.slug ? `/courses/${params.slug}` : "/courses"} variant="outline">
          Back to course
        </ButtonLink>
      </div>
    </div>
  );
}
