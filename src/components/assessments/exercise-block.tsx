import { getCurrentUser } from "@/lib/auth/session";
import { getSettings } from "@/lib/db/store";
import { getLessonHref } from "@/lib/data/courses";
import { canManageAssessments, getExercise, getOwnExerciseSubmission, toExerciseSubmissionView, toRunnerExercise } from "@/lib/data/assessments";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icons";
import { ExerciseRunner } from "./exercise-runner";

/**
 * Programming exercise embedded in a lesson: problem statement, code editor,
 * in-browser test run and server-validated submission, all inline.
 */
export async function ExerciseBlock({ exerciseId, lessonId, courseId }: { exerciseId: string; lessonId?: string; courseId?: string }) {
  const [exercise, user, settings] = await Promise.all([getExercise(exerciseId), getCurrentUser(), getSettings()]);

  if (!exercise) {
    return (
      <Card className="flex items-center gap-3 p-4 text-sm text-ink-muted">
        <Icon.AlertCircle className="size-5 shrink-0 text-ink-faint" />
        This programming exercise is no longer available.
      </Card>
    );
  }
  if (!settings.features.programmingExercises) {
    return (
      <Card className="flex items-center gap-3 p-4 text-sm text-ink-muted">
        <Icon.Code className="size-5 shrink-0 text-ink-faint" />
        Programming exercises are currently turned off.
      </Card>
    );
  }

  const revealHidden = canManageAssessments(user);
  const own = user ? await getOwnExerciseSubmission(user.id, exercise.id) : null;
  const runner = toRunnerExercise(exercise, { revealHidden });
  const lessonHref = lessonId ? await getLessonHref(lessonId) : null;
  const loginHref = `/login?next=${encodeURIComponent(lessonHref ?? `/exercises/${exercise.id}`)}`;

  return (
    <ExerciseRunner
      variant="inline"
      exercise={runner}
      initialCode={own?.code ?? runner.starterCode}
      submission={own ? toExerciseSubmissionView(own, exercise, { revealHidden }) : null}
      lessonId={lessonId}
      courseId={courseId ?? exercise.courseId}
      canSubmit={!!user}
      loginHref={loginHref}
      revealHidden={revealHidden}
    />
  );
}
