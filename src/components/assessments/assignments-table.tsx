import type { ComponentProps } from "react";
import { LearningI18n } from "@/components/learn/learning-i18n";
import { AssignmentsTableView } from "./assignments-table-view";

/** Assignment list of /admin/assignments. Server wrapper: provides the `learning` messages the client table reads. */
export function AssignmentsTable(props: ComponentProps<typeof AssignmentsTableView>) {
  return (
    <LearningI18n slices={["assessAdmin."]}>
      <AssignmentsTableView {...props} />
    </LearningI18n>
  );
}
