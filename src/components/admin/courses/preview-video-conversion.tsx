"use client";

import type { CoursePreviewMediaStatus } from "@/lib/media/transcode/status";
import { cancelCoursePreviewTranscodeAction, transcodeCoursePreviewAction } from "@/lib/actions/storage-settings";
import { MediaConversionPanel } from "./media-conversion-panel";

/**
 * Adaptive-streaming state of a course's preview video in the course
 * settings: "Processing 42% (1080p/720p/480p)", "Ready" with the qualities,
 * "Failed" with Retry, or that the converter is not installed (the original
 * file plays). Polls `GET /api/media/status?courseId=`.
 */
export function PreviewVideoConversion({ courseId, src }: { courseId: string; src: string }) {
  if (!src.trim()) return null;
  return (
    <MediaConversionPanel<CoursePreviewMediaStatus>
      id={`course-preview-${courseId}`}
      query={new URLSearchParams({ courseId }).toString()}
      src={src}
      subject="course"
      description="An uploaded preview video is converted to several qualities so the course page plays smoothly on any connection."
      convert={() => transcodeCoursePreviewAction(courseId)}
      cancel={() => cancelCoursePreviewTranscodeAction(courseId)}
    />
  );
}
