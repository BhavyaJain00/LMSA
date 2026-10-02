import type { ComponentProps } from "react";
import { LearningI18n } from "@/components/learn/learning-i18n";
import { ExerciseSubmissionsTableView, ExercisesTableView } from "./exercises-table-view";

/** Exercise list of /admin/exercises. Server wrapper: provides the `learning` messages the client table reads. */
export function ExercisesTable(props: ComponentProps<typeof ExercisesTableView>) {
  return (
    <LearningI18n slices={["assessAdmin."]}>
      <ExercisesTableView {...props} />
    </LearningI18n>
  );
}

/** Submission list of /admin/exercises/submissions. Server wrapper: provides the `learning` messages the client table reads. */
export function ExerciseSubmissionsTable(props: ComponentProps<typeof ExerciseSubmissionsTableView>) {
  return (
    <LearningI18n slices={["assessAdmin."]}>
      <ExerciseSubmissionsTableView {...props} />
    </LearningI18n>
  );
}
