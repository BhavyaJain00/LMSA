"use client";

import { useActionState } from "react";
import { createQuizAction } from "@/lib/actions/quiz";
import { Button, ButtonLink } from "@/components/ui/button";
import { Field, FormError, Input, Select } from "@/components/ui/input";
import { useT } from "@/i18n/client";
import type { CourseOption } from "./types";

export function NewQuizFormView({ courses, defaultCourseId }: { courses: CourseOption[]; defaultCourseId?: string }) {
  const t = useT("learning");
  const tc = useT("common");
  const [state, action, pending] = useActionState(createQuizAction, null);
  const errors = state && !state.ok ? (state.fieldErrors ?? {}) : {};
  return (
    <form action={action} className="space-y-5" noValidate>
      <FormError message={state && !state.ok && !Object.keys(errors).length ? state.error : null} />
      <Field label={t("quizAdmin.newQuiz.title")} htmlFor="quiz-title" required error={errors.title} hint={t("quizAdmin.newQuiz.titleHint")}>
        <Input id="quiz-title" name="title" required autoFocus maxLength={200} placeholder={t("quizAdmin.newQuiz.titlePlaceholder")} invalid={!!errors.title} />
      </Field>
      <Field label={t("quizAdmin.newQuiz.course")} htmlFor="quiz-course" error={errors.courseId} hint={t("quizAdmin.newQuiz.courseHint")}>
        <Select id="quiz-course" name="courseId" defaultValue={defaultCourseId ?? ""} invalid={!!errors.courseId}>
          <option value="">{t("quizAdmin.newQuiz.noCourse")}</option>
          {courses.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("quizAdmin.newQuiz.passing")} htmlFor="quiz-passing" required error={errors.passingPercentage} hint={t("quizAdmin.newQuiz.passingHint")}>
        <Input
          id="quiz-passing"
          name="passingPercentage"
          type="number"
          min={0}
          max={100}
          step="1"
          defaultValue={70}
          required
          rightAddon={<span className="text-sm">%</span>}
          invalid={!!errors.passingPercentage}
        />
      </Field>
      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
        <ButtonLink href="/admin/quizzes" variant="outline">
          {tc("actions.cancel")}
        </ButtonLink>
        <Button type="submit" loading={pending}>
          {t("quizAdmin.newQuiz.create")}
        </Button>
      </div>
    </form>
  );
}
