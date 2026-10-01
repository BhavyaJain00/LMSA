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
import { formatNumber, percent } from "@/lib/utils";

export const metadata = { title: "AI tutor settings" };

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
  await requireRole(["admin"], "/admin/settings/ai");
  const db = await getDb();
  const site = aiSiteStatus(db.settings);
  const coursesOn = db.courses.filter((c) => c.aiTutorEnabled);
  const { answers, unknown, awaitingReview } = tutorStats(db.aiMessages);

  const status = site.ready ? "Ready" : !site.enabled ? "Off" : "Key missing";
  const baseRules = buildSystemPrompt({ siteName: db.settings.brand.name, courseTitle: "<course title>", addition: null });

  return (
    <>
      <SettingsPanelHeader
        title="AI tutor"
        description="A teaching assistant that answers learners' questions using only each course's own material, with links to the lessons it used."
        actions={
          <ButtonLink href="/admin/ai" variant="outline" size="sm" leftIcon={<Icon.Sparkles className="size-4" />}>
            Review queue
          </ButtonLink>
        }
      />
      <div className="mb-6 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard
          label="Status"
          value={status}
          hint={site.ready ? "Learners can ask in enabled courses" : !site.enabled ? "Turn it on below" : "Add ANTHROPIC_API_KEY"}
          icon={<Icon.Sparkles className="size-5" />}
        />
        <StatCard
          label="Courses with the tutor"
          value={`${formatNumber(coursesOn.length)}/${formatNumber(db.courses.length)}`}
          hint="Switch it on in a course's Settings tab"
          icon={<Icon.BookOpen className="size-5" />}
        />
        <StatCard label="Answers (30 days)" value={formatNumber(answers)} hint={answers ? `${percent(unknown, answers)}% not covered by the course` : "No questions yet"} icon={<Icon.MessageSquare className="size-5" />} />
        <StatCard label="Awaiting review" value={formatNumber(awaitingReview)} hint="Flagged or reported answers" icon={<Icon.AlertCircle className="size-5" />} />
      </div>
      <AiSettingsForm initial={db.settings.ai} keyHint={aiKeyHint()} baseRules={baseRules} />
    </>
  );
}
