import "server-only";
import type { Course } from "@/lib/types";
import { siteConfig } from "@/lib/config";
import { coursePreviewHlsUrl } from "./transcode/targets";

/**
 * What the course page's player needs for the preview video: the uploaded
 * file (progressive fallback), the HLS master playlist made from it (only
 * while it belongs to the current file) and a poster (the cover image, else
 * the frame captured during the conversion). Protected uploads are signed by
 * the player itself through `/api/media/sign`, which authorizes course
 * preview streams for anyone who can see the course.
 */
export interface CoursePreviewPlayback {
  src: string;
  hlsUrl?: string;
  poster?: string;
}

export function coursePreviewPlayback(course: Pick<Course, "videoUrl" | "previewHlsUrl" | "previewStorageKey" | "previewPosterUrl" | "imageUrl">): CoursePreviewPlayback | null {
  if (!course.videoUrl) return null;
  return {
    src: course.videoUrl,
    hlsUrl: coursePreviewHlsUrl(course, [siteConfig.appUrl]),
    poster: course.imageUrl || course.previewPosterUrl || undefined,
  };
}
