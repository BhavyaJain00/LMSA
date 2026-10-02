import type { ComponentProps } from "react";
import { LearningI18n } from "@/components/learn/learning-i18n";
import { SubmissionsTableView } from "./submissions-table-view";

/** Submission list of /admin/quizzes/submissions. Server wrapper: provides the `learning` messages the client table reads. */
export function SubmissionsTable(props: ComponentProps<typeof SubmissionsTableView>) {
  return (
    <LearningI18n slices={["quizAdmin.submissions.", "quizAdmin.common."]}>
      <SubmissionsTableView {...props} />
    </LearningI18n>
  );
}
