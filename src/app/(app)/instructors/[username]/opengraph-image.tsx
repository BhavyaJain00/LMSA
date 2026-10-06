import { OG_CONTENT_TYPE, renderFallbackOgCard, renderOgCard } from "@/components/seo/og-card";
import { getSettings } from "@/lib/db/store";
import { catalogIsPublic, getInstructorProfile } from "@/lib/data/seo";
import { OG_IMAGE_SIZE } from "@/lib/seo/metadata";
import { decodeSegment } from "@/lib/seo/site";
import { pluralize } from "@/lib/utils";

export const alt = "Instructor profile: name, headline, courses and learners";
export const size = OG_IMAGE_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function InstructorOpengraphImage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  const settings = await getSettings();
  const profile = catalogIsPublic(settings) ? await getInstructorProfile(decodeSegment(username) ?? "") : null;
  if (!profile) return renderFallbackOgCard();
  const { instructor } = profile;
  return renderOgCard({
    eyebrow: "Instructor",
    title: instructor.name,
    summary: instructor.headline,
    rating: instructor.averageRating !== null ? { value: instructor.averageRating, count: instructor.reviewCount } : null,
    facts: [pluralize(instructor.courseCount, "course"), instructor.learnerCount > 0 ? pluralize(instructor.learnerCount, "learner") : "", instructor.categories[0] ?? ""].filter(Boolean),
  });
}
