import { OG_CONTENT_TYPE, renderFallbackOgCard, renderOgCard } from "@/components/seo/og-card";
import { getDb, getSettings } from "@/lib/db/store";
import { getProgramBySlug } from "@/lib/data/programs";
import { OG_IMAGE_SIZE } from "@/lib/seo/metadata";
import { isCoursePublic, isProgramPublic, sectionIsPublic } from "@/lib/seo/visibility";
import { plainText } from "@/lib/seo/text";

export const alt = "Program overview: title and the courses it includes";
export const size = OG_IMAGE_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function ProgramOpengraphImage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!sectionIsPublic(await getSettings(), "programs")) return renderFallbackOgCard();
  const program = await getProgramBySlug(slug);
  if (!program || !isProgramPublic(program)) return renderFallbackOgCard();
  const db = await getDb();
  const now = Date.now();
  const courses = program.courseIds.map((id) => db.courses.find((c) => c.id === id)).filter((c) => !!c && isCoursePublic(c, now));
  const facts = [`${courses.length} ${courses.length === 1 ? "course" : "courses"}`];
  if (program.enforceCourseOrder) facts.push("Guided order");
  return renderOgCard({ eyebrow: "Learning program", title: program.title, summary: plainText(program.description), facts });
}
