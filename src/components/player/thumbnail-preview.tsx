"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import type { ThumbnailFrame } from "./use-seek-thumbnails";

/**
 * Visible canvas for the seek-bar tooltip. Copies the cached frame canvas
 * (160 px wide) whenever the frame changes; while the first frame is still
 * being generated it shows a shimmer of the same size.
 */
export function ThumbnailPreview({ frame, stale }: { frame: ThumbnailFrame | null; stale: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !frame) return;
    if (canvas.width !== frame.width) canvas.width = frame.width;
    if (canvas.height !== frame.height) canvas.height = frame.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    try {
      ctx.drawImage(frame.canvas, 0, 0);
    } catch {
      /* the frame canvas is always same-origin; nothing to recover */
    }
  }, [frame]);

  if (!frame) return <div className="h-[90px] w-40 animate-pulse bg-white/10" aria-hidden="true" />;
  return (
    <canvas
      ref={canvasRef}
      width={frame.width}
      height={frame.height}
      aria-hidden="true"
      className={cn("block w-40 transition-opacity duration-150", stale ? "opacity-70" : "opacity-100")}
      style={{ aspectRatio: `${frame.width} / ${frame.height}` }}
    />
  );
}
