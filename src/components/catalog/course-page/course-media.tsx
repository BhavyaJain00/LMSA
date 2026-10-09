import { preload } from "react-dom";
import type { CourseSummary } from "@/lib/types";
import { getT } from "@/i18n/server";
import { coursePreviewPlayback } from "@/lib/media/course-preview";
import { cn } from "@/lib/utils";
import { CourseCover } from "../course-cover";
import { PreviewVideo } from "./preview-video";

/**
 * The course artwork next to the enroll card: the preview video (custom player, adaptive HLS once converted)
 * when the course has one, otherwise the cover in a rounded card. The cover (or the video poster) is the page's
 * largest image, so it is fetched with high priority.
 */
export async function CourseMedia({ course, className }: { course: CourseSummary; className?: string }) {
  const t = await getT("public");
  const preview = coursePreviewPlayback(course);
  if (preview && course.imageUrl) preload(course.imageUrl, { as: "image", fetchPriority: "high" });
  const cover = (
    <CourseCover title={course.title} imageUrl={course.imageUrl} gradient={course.cardGradient} variant="hero" alt={course.title} priority="high" className="aspect-video w-full" />
  );
  return (
    <div className={cn("overflow-hidden rounded-card border border-border bg-surface-3 shadow-card", className)}>
      {preview ? (
        <PreviewVideo src={preview.src} hlsUrl={preview.hlsUrl} poster={preview.poster} title={t("course.hero.previewTitle", { title: course.title })} fallback={cover} />
      ) : (
        cover
      )}
    </div>
  );
}
