import type { PrerequisiteStatus } from "@/lib/services/drip";
import { Badge } from "@/components/ui/badge";
import { getT } from "@/i18n/server";
import { PrerequisiteList } from "../prerequisite-list";
import { SectionCard } from "./section-card";

/** Anchor of the card (linked from the enroll card's "complete prerequisites" state). */
export const PREREQUISITES_ANCHOR = "prerequisites";

/**
 * Courses to complete before this one, with the viewer's status on each and what it means for them (blocking,
 * recommended, all done; the rule itself for course staff; "log in to see your progress" for guests).
 */
export async function PrerequisitesCard({ status, loggedIn, manager }: { status: PrerequisiteStatus; loggedIn: boolean; manager: boolean }) {
  if (!status.items.length) return null;
  const t = await getT("public");
  const allDone = loggedIn && !status.missing.length;
  const description = manager
    ? t("enroll.prerequisites.manager")
    : !loggedIn
      ? t("enroll.prerequisites.guest")
      : allDone
        ? t("enroll.prerequisites.allDone")
        : status.blocking
          ? t("enroll.prerequisites.blocking", { count: status.missing.length })
          : t("enroll.prerequisites.recommended");
  return (
    <SectionCard
      id={PREREQUISITES_ANCHOR}
      headingId="prerequisites-heading"
      title={t("enroll.prerequisites.title")}
      description={description}
      aside={
        loggedIn && !manager ? (
          <Badge tone={allDone ? "success" : "warning"} size="sm">
            {t("enroll.prerequisites.done", { done: status.items.length - status.missing.length, total: status.items.length })}
          </Badge>
        ) : undefined
      }
    >
      <PrerequisiteList items={status.items} />
    </SectionCard>
  );
}
