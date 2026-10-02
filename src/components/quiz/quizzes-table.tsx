import type { ComponentProps } from "react";
import { LearningI18n } from "@/components/learn/learning-i18n";
import { QuizzesTableView } from "./quizzes-table-view";

/** Quiz list of /admin/quizzes. Server wrapper: provides the `learning` messages the client table reads. */
export function QuizzesTable(props: ComponentProps<typeof QuizzesTableView>) {
  return (
    <LearningI18n slices={["quizAdmin.quizzes.", "quizAdmin.common."]}>
      <QuizzesTableView {...props} />
    </LearningI18n>
  );
}
