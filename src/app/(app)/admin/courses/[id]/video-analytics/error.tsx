"use client";

import { useEffect } from "react";
import { useParams } from "next/navigation";
import { Button, ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";

export default function VideoAnalyticsError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const params = useParams<{ id: string }>();
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div role="alert" className="flex min-h-[50vh] flex-col items-center justify-center rounded-card border border-dashed border-border-strong px-6 py-16 text-center">
      <span className="mb-3 flex size-12 items-center justify-center rounded-full bg-danger/10 text-danger">
        <Icon.AlertTriangle className="size-6" />
      </span>
      <h1 className="text-lg font-semibold text-ink">We couldn&apos;t load the video analytics</h1>
      <p className="mt-1 max-w-md text-sm text-ink-muted">Something went wrong while crunching the viewing data. Please try again.</p>
      {error.digest && <p className="mt-2 font-mono text-xs text-ink-faint">Reference: {error.digest}</p>}
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <Button onClick={() => retry()} leftIcon={<Icon.Refresh className="size-4" />}>
          Try again
        </Button>
        <ButtonLink href={params?.id ? `/admin/courses/${params.id}?tab=dashboard` : "/admin/courses"} variant="outline">
          Back to the course
        </ButtonLink>
      </div>
    </div>
  );
}
