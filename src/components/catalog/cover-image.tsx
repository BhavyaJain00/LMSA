"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Cover image that removes itself when it cannot be loaded, so the course artwork drawn underneath shows
 * instead of a broken-image icon. Also checks after hydration, for images that failed before React attached.
 */
export function CoverImage({
  src,
  alt,
  priority,
  className,
}: {
  src: string;
  alt: string;
  priority?: "high" | "eager";
  className?: string;
}) {
  const ref = useRef<HTMLImageElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const img = ref.current;
    if (img && img.complete && img.naturalWidth === 0) setFailed(true);
  }, []);
  if (failed) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={ref}
      src={src}
      alt={alt}
      loading={priority ? "eager" : "lazy"}
      fetchPriority={priority === "high" ? "high" : undefined}
      decoding="async"
      onError={() => setFailed(true)}
      className={className}
    />
  );
}
