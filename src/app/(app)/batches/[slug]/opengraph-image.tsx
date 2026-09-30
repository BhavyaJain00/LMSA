import { OG_CONTENT_TYPE, renderOgCard, renderSiteOgCard } from "@/components/seo/og-card";
import { getBatchBySlug } from "@/lib/data/batches";
import { getPublicUsers } from "@/lib/data/users";
import { OG_IMAGE_SIZE } from "@/lib/seo/metadata";
import { isBatchPublic } from "@/lib/seo/visibility";
import { plainText } from "@/lib/seo/text";
import { formatDate, formatPrice } from "@/lib/utils";

export const alt = "Batch overview: title, dates, instructors and price";
export const size = OG_IMAGE_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function BatchOpengraphImage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const batch = await getBatchBySlug(slug);
  if (!batch || !isBatchPublic(batch)) return renderSiteOgCard();
  const instructors = (await getPublicUsers(batch.instructorIds)).map((u) => u.name);
  const facts = [`${formatDate(batch.startDate)} – ${formatDate(batch.endDate)}`];
  if (instructors.length) facts.push(`With ${instructors.slice(0, 2).join(" & ")}`);
  facts.push(batch.medium === "online" ? "Live online" : "In person");
  facts.push(batch.paidBatch && batch.amount > 0 ? formatPrice(batch.amount, batch.currency) : "Free");
  return renderOgCard({ eyebrow: "Live batch", title: batch.title, summary: plainText(batch.description), facts });
}
