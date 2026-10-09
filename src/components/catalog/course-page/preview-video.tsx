"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { VideoPlayer } from "@/components/player";

const noopSubscribe = () => () => undefined;

/**
 * The course preview video, mounted in the browser only. The player feature-detects things like
 * picture-in-picture while rendering, so its server HTML differed from the first client render (React hydration
 * error #418 on the course page). Until hydration the poster (`fallback`, the course cover) is shown in its place.
 */
export function PreviewVideo({
  src,
  hlsUrl,
  poster,
  title,
  fallback,
}: {
  src: string;
  hlsUrl?: string;
  poster?: string;
  title: string;
  fallback: ReactNode;
}) {
  const mounted = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
  if (!mounted) return <>{fallback}</>;
  return <VideoPlayer src={src} hlsUrl={hlsUrl} poster={poster} title={title} className="rounded-none" />;
}
