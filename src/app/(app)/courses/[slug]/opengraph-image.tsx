import { OG_CONTENT_TYPE, renderFallbackOgCard, renderOgCard } from "@/components/seo/og-card";
import { getSettings } from "@/lib/db/store";
import { getCourseBySlug, getCourseSummary } from "@/lib/data/courses";
import { OG_IMAGE_SIZE } from "@/lib/seo/metadata";
import { isCoursePublic, sectionIsPublic } from "@/lib/seo/visibility";
import { plainText } from "@/lib/seo/text";
import { formatPrice } from "@/lib/utils";

export const alt = "Course overview: title, instructors, rating and price";
export const size = OG_IMAGE_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function CourseOpengraphImage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  // Members-only catalogs (or a switched-off course catalog) show strangers nothing but the site card.
  if (!sectionIsPublic(await getSettings(), "courses")) return renderFallbackOgCard();
  const course = await getCourseBySlug(slug);
  if (!course || !isCoursePublic(course)) return renderFallbackOgCard();
  const summary = await getCourseSummary(course.id, null);
  const instructors = summary?.instructors.map((i) => i.name) ?? [];
  const facts: string[] = [];
  if (instructors.length) facts.push(`By ${instructors.slice(0, 2).join(" & ")}${instructors.length > 2 ? " +" : ""}`);
  if (summary?.lessonCount) facts.push(`${summary.lessonCount} ${summary.lessonCount === 1 ? "lesson" : "lessons"}`);
  facts.push(course.upcoming ? "Coming soon" : course.paidCourse && course.price > 0 ? formatPrice(course.price, course.currency) : "Free");
  return renderOgCard({
    eyebrow: summary?.category ? `Course · ${summary.category.name}` : "Course",
    title: course.title,
    summary: course.shortIntroduction || plainText(course.description),
    facts,
    rating: summary?.averageRating ? { value: summary.averageRating, count: summary.reviewCount } : null,
  });
}
