import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db/store";
import {
  canManageAssessments,
  getExercise,
  getOwnExerciseSubmission,
  getReturnLink,
  toExerciseSubmissionView,
  toRunnerExercise,
} from "@/lib/data/assessments";
import { getAssessmentAccess } from "@/lib/data/lessons";
import { PageHeader } from "@/components/ui/card";
import { ButtonLink } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/skeleton";
import { Icon } from "@/components/ui/icons";
import { ExerciseRunner } from "@/components/assessments/exercise-runner";
import { Breadcrumbs, type Crumb } from "@/components/assessments/breadcrumbs";
import { LANGUAGE_LABELS, lessonQuery, param } from "@/components/assessments/shared";
import { getT } from "@/i18n/server";

export async function generateMetadata(props: PageProps<"/exercises/[id]">): Promise<Metadata> {
  const { id } = await props.params;
  const [exercise, t] = await Promise.all([getExercise(id), getT("learning")]);
  return { title: exercise ? exercise.title : t("exercise.eyebrow") };
}

export default async function ExercisePage(props: PageProps<"/exercises/[id]">) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  const lessonParam = param(sp.lesson);
  const courseIdParam = param(sp.course);
  const user = await requireUser(`/exercises/${id}${lessonQuery(lessonParam, courseIdParam)}`);

  const [exercise, t] = await Promise.all([getExercise(id), getT("learning")]);
  if (!exercise) notFound();
  const db = await getDb();
  const staff = canManageAssessments(user);

  if (!db.settings.features.programmingExercises && !staff) {
    return (
      <EmptyState
        icon={<Icon.Code />}
        title={t("learn.exercisesOff.title")}
        description={t("learn.exercisesOff.body")}
        action={<ButtonLink href="/courses">{t("quiz.page.browseCourses")}</ButtonLink>}
      />
    );
  }

  const courseId = courseIdParam ?? exercise.courseId;
  const course = courseId ? db.courses.find((c) => c.id === courseId) : undefined;

  // Learners reach an exercise through a lesson they can open (drip schedule, enforced order and
  // prerequisites apply) or a batch that lists it; staff always can.
  const gate = staff ? null : await getAssessmentAccess(user, "exercise", exercise.id);
  if (gate && !gate.ok) {
    return (
      <div className="animate-fade-in">
        <PageHeader
          breadcrumbs={<Breadcrumbs items={[{ label: t("exercise.page.crumbSubmissions"), href: "/exercises/submissions" }, { label: exercise.title }]} />}
          title={exercise.title}
        />
        <EmptyState
          icon={<Icon.Lock />}
          title={t("exercise.page.locked")}
          description={gate.message}
          action={<ButtonLink href={gate.courseHref ?? "/courses"}>{gate.courseHref ? t("quiz.page.viewCourse") : t("quiz.page.browseCourses")}</ButtonLink>}
        />
      </div>
    );
  }
  // A lesson named in the URL only counts while the learner can open it.
  const lessonId = lessonParam && (staff || gate?.openLessonIds.includes(lessonParam)) ? lessonParam : undefined;

  const own = await getOwnExerciseSubmission(user.id, exercise.id);
  const back = await getReturnLink(lessonId ?? own?.lessonId, courseId);
  const runner = toRunnerExercise(exercise, { revealHidden: staff });

  const crumbs: Crumb[] = staff
    ? [{ label: t("exercise.page.crumbExercises"), href: "/admin/exercises" }, { label: exercise.title }]
    : [{ label: t("exercise.page.crumbSubmissions"), href: "/exercises/submissions" }, { label: exercise.title }];

  return (
    <div className="animate-fade-in">
      <PageHeader
        breadcrumbs={<Breadcrumbs items={crumbs} />}
        title={
          <span className="flex flex-wrap items-center gap-2">
            {exercise.title}
            <Badge tone="outline">{LANGUAGE_LABELS[exercise.language]}</Badge>
          </span>
        }
        description={course ? t("exercise.page.forCourse", { course: course.title }) : t("exercise.eyebrow")}
        actions={
          <>
            {back && (
              <ButtonLink href={back.href} variant="outline" leftIcon={<Icon.ArrowLeft className="size-4 rtl:rotate-180" />}>
                {t("assignment.page.backTo", { title: back.label.replace(/^Back to /, "") })}
              </ButtonLink>
            )}
            {staff && (
              <ButtonLink href={`/admin/exercises/${exercise.id}`} variant="ghost" leftIcon={<Icon.Edit className="size-4" />}>
                {t("exercise.detail.edit")}
              </ButtonLink>
            )}
          </>
        }
      />
      {!db.settings.features.programmingExercises && (
        <p className="mb-4 flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
          <Icon.AlertTriangle className="size-4 shrink-0" />
          {t("exercise.page.offForLearners")}
        </p>
      )}
      <ExerciseRunner
        variant="page"
        exercise={runner}
        initialCode={own?.code ?? runner.starterCode}
        submission={own ? toExerciseSubmissionView(own, exercise, { revealHidden: staff }) : null}
        lessonId={lessonId}
        courseId={courseId}
        canSubmit
        revealHidden={staff}
      />
    </div>
  );
}
