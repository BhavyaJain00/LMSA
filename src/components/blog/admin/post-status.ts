import type { BlogPostStatus } from "@/lib/types";
import type { BadgeTone } from "@/components/ui/badge";

/** Label and badge tone of each article status (admin list and editor header). */
export const POST_STATUS: Record<BlogPostStatus, { label: string; tone: BadgeTone }> = {
  draft: { label: "Draft", tone: "neutral" },
  scheduled: { label: "Scheduled", tone: "info" },
  published: { label: "Published", tone: "success" },
};
