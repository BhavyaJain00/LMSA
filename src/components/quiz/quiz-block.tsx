import Link from "next/link";
import { findById } from "@/lib/db/store";
import { getCurrentUser } from "@/lib/auth/session";
import { getLessonHref } from "@/lib/data/courses";
import { getQuizAccess, getRunnerPayload } from "@/lib/data/quiz";
import { ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { getT } from "@/i18n/server";
import { QuizRunner } from "./quiz-runner";

function BlockMessage({ icon, title, description, action }: { icon: React.ReactNode; title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-card border border-border bg-surface-1 px-6 py-14 text-center shadow-card">
      <span className="mb-3 flex size-12 items-center justify-center rounded-full bg-surface-2 text-ink-faint [&>svg]:size-6">{icon}</span>
      <p className="font-semibold text-ink">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-ink-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/**
 * A quiz embedded in a lesson: intro card → runner → results, all inline.
 * Server component — it loads the quiz for the current viewer and hands a
 * client-safe payload (no answer keys) to the runner.
 */
export async function QuizBlock({
  quizId,
  lessonId,
  courseId,
  inVideo,
}: {
  quizId: string;
  lessonId?: string;
  courseId?: string;
  /** Rendered inside the video player overlay (adds the "continue the video" hints). */
  inVideo?: boolean;
}) {
  const [quiz, t] = await Promise.all([findById("quizzes", quizId), getT("learning")]);
  if (!quiz) {
    return <BlockMessage icon={<Icon.Question />} title={t("quiz.block.goneTitle")} description={t("quiz.block.goneBody")} />;
  }

  const user = await getCurrentUser();
  if (!user) {
    const back = (await getLessonHref(lessonId)) ?? `/quiz/${quiz.id}`;
    return (
      <BlockMessage
        icon={<Icon.Lock />}
        title={t("quiz.block.loginTitle")}
        description={quiz.title}
        action={
          <ButtonLink href={`/login?next=${encodeURIComponent(back)}`} leftIcon={<Icon.LogIn className="size-4" />}>
            {t("quiz.block.login")}
          </ButtonLink>
        }
      />
    );
  }

  const access = await getQuizAccess(user, quiz);
  if (!access.ok) {
    return (
      <BlockMessage
        icon={<Icon.Lock />}
        title={access.reason === "locked" ? t("quiz.block.lockedTitle") : t("quiz.block.notYetTitle")}
        description={access.reason === "locked" ? access.message : t("quiz.block.enrollBody")}
      />
    );
  }

  const payload = await getRunnerPayload(quiz, user, access.manage);
  return (
    <div className="not-prose space-y-2">
      {access.manage && !inVideo && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed border-border-strong bg-surface-2/60 px-3 py-2 text-xs text-ink-muted">
          <span className="inline-flex items-center gap-1.5">
            <Icon.Info className="size-3.5" />
            {t("quiz.block.managerNote")}
          </span>
          <span className="flex items-center gap-3">
            <Link href={`/admin/quizzes/submissions?quiz=${quiz.id}`} className="font-medium text-accent hover:underline">
              {t("quiz.page.submissions")}
            </Link>
            <Link href={`/admin/quizzes/${quiz.id}`} className="font-medium text-accent hover:underline">
              {t("quiz.page.editQuiz")}
            </Link>
          </span>
        </div>
      )}
      <QuizRunner payload={payload} lessonId={lessonId} courseId={courseId} inVideo={inVideo} />
    </div>
  );
}
