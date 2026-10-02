import type { ComponentProps } from "react";
import { LearningI18n } from "@/components/learn/learning-i18n";
import { ExerciseFormView } from "./exercise-form-view";

export type { ExerciseFormValues } from "./exercise-form-view";

/** Create/edit form of /admin/exercises. Server wrapper: provides the `learning` messages the client form reads. */
export function ExerciseForm(props: ComponentProps<typeof ExerciseFormView>) {
  return (
    <LearningI18n slices={["assessAdmin.", "exercise."]}>
      <ExerciseFormView {...props} />
    </LearningI18n>
  );
}
