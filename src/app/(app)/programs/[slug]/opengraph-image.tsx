import { OG_CONTENT_TYPE, renderOgCard, renderSiteOgCard } from "@/components/seo/og-card";
import { getDb } from "@/lib/db/store";
import { getProgramBySlug } from "@/lib/data/programs";
import { OG_IMAGE_SIZE } from "@/lib/seo/metadata";
import { isCoursePublic, isProgramPublic } from "@/lib/seo/visibility";
import { plainText } from "@/lib/seo/text";

export const alt = "Program overview: title and the courses it includes";
export const size = OG_IMAGE_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function ProgramOpengraphImage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const program = await getProgramBySlug(slug);
  if (!program || !isProgramPublic(program)) return renderSiteOgCard();
  const db = await getDb();
  const now = Date.now();
  const courses = program.courseIds.map((id) => db.courses.find((c) => c.id === id)).filter((c) => !!c && isCoursePublic(c, now));
  const facts = [`${courses.length} ${courses.length === 1 ? "course" : "courses"}`];
  if (program.enforceCourseOrder) facts.push("Guided order");
  return renderOgCard({ eyebrow: "Learning program", title: program.title, summary: plainText(program.description), facts });
}
