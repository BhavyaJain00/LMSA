import type { Database } from "@/lib/types";
import { requireRole } from "@/lib/auth/session";
import { getDb } from "@/lib/db/store";
import { aiKeyHint, aiSiteStatus } from "@/lib/ai/access";
import { buildSystemPrompt, isUnknownAnswer } from "@/lib/ai/prompt";
import { ButtonLink } from "@/components/ui/button";
import { StatCard } from "@/components/ui/card";
import { Icon } from "@/components/ui/icons";
import { SettingsPanelHeader } from "@/components/admin/settings/settings-ui";
import { AiSettingsForm } from "@/components/admin/settings/ai-settings-form";
import { percent } from "@/lib/utils";
import { getFormatter } from "@/i18n/server";
import type { Metadata } from "next";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("admin");
  return { title: t("pages.settings.ai.metaTitle") };
}

const DAY_MS = 86_400_000;

/** Answers of the last 30 days, how many the course didn't cover, and flagged answers not yet reviewed. */
function tutorStats(messages: Database["aiMessages"], now = Date.now()) {
  const since = new Date(now - 30 * DAY_MS).toISOString();
  let answers = 0;
  let unknown = 0;
  let awaitingReview = 0;
  for (const m of messages) {
    if (m.role !== "assistant") continue;
    if (m.createdAt >= since) {
      answers++;
      if (isUnknownAnswer(m.content)) unknown++;
    }
    if (m.flagged && m.reviewStatus !== "approved" && m.reviewStatus !== "corrected") awaitingReview++;
  }
  return { answers, unknown, awaitingReview };
}

export default async function AiSettingsPage() {
  const t = await getT("admin");
  await requireRole(["admin"], "/admin/settings/ai");
  const [db, f] = await Promise.all([getDb(), getFormatter()]);
  const formatNumber = (n: number) => f.number(n);
  const site = aiSiteStatus(db.settings);
  const coursesOn = db.courses.filter((c) => c.aiTutorEnabled);
  const { answers, unknown, awaitingReview } = tutorStats(db.aiMessages);

  const status = site.ready ? t("pages.settings.ai.status.ready") : !site.enabled ? t("pages.settings.ai.status.off") : t("pages.settings.ai.status.keyMissing");
  const baseRules = buildSystemPrompt({ siteName: db.settings.brand.name, courseTitle: "<course title>", addition: null });

  return (
    <>
      <SettingsPanelHeader
        title={t("pages.settings.ai.title")}
        description={t("pages.settings.ai.description")}
        actions={
          <ButtonLink href="/admin/ai" variant="outline" size="sm" leftIcon={<Icon.Sparkles className="size-4" />}>
            {t("pages.settings.ai.reviewQueue")}
          </ButtonLink>
        }
      />
      <div className="mb-6 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard
          label={t("pages.settings.ai.stats.status")}
          value={status}
          hint={site.ready ? t("pages.settings.ai.stats.readyHint") : !site.enabled ? t("pages.settings.ai.stats.offHint") : t("pages.settings.ai.stats.keyHint")}
          icon={<Icon.Sparkles className="size-5" />}
        />
        <StatCard
          label={t("pages.settings.ai.stats.courses")}
          value={`${formatNumber(coursesOn.length)}/${formatNumber(db.courses.length)}`}
          hint={t("pages.settings.ai.stats.coursesHint")}
          icon={<Icon.BookOpen className="size-5" />}
        />
        <StatCard label={t("pages.settings.ai.stats.answers")} value={formatNumber(answers)} hint={answers ? t("pages.settings.ai.stats.notCovered", { rate: f.percent(percent(unknown, answers)) }) : t("pages.settings.ai.stats.noQuestions")} icon={<Icon.MessageSquare className="size-5" />} />
        <StatCard label={t("pages.settings.ai.stats.awaiting")} value={formatNumber(awaitingReview)} hint={t("pages.settings.ai.stats.awaitingHint")} icon={<Icon.AlertCircle className="size-5" />} />
      </div>
      <AiSettingsForm initial={db.settings.ai} keyHint={aiKeyHint()} baseRules={baseRules} />
    </>
  );
}
