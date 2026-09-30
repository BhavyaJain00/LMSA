import { OG_CONTENT_TYPE, renderOgCard, renderSiteOgCard } from "@/components/seo/og-card";
import { getJobBySlug } from "@/lib/data/jobs";
import { OG_IMAGE_SIZE } from "@/lib/seo/metadata";
import { isJobPublic } from "@/lib/seo/visibility";

export const alt = "Job opening: role, company, location and type";
export const size = OG_IMAGE_SIZE;
export const contentType = OG_CONTENT_TYPE;

const TYPE_LABEL = { full_time: "Full-time", part_time: "Part-time", contract: "Contract", freelance: "Freelance", internship: "Internship" } as const;
const MODE_LABEL = { onsite: "On-site", remote: "Remote", hybrid: "Hybrid" } as const;

export default async function JobOpengraphImage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const job = await getJobBySlug(slug);
  if (!job || !isJobPublic(job)) return renderSiteOgCard();
  const mode = job.workMode ?? (job.remote ? "remote" : "onsite");
  const facts = [job.location, MODE_LABEL[mode], TYPE_LABEL[job.type], job.salaryRange ?? ""].filter((f) => f.trim());
  return renderOgCard({ eyebrow: `Hiring · ${job.company}`, title: job.title, facts });
}
