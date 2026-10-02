import type { ComponentProps } from "react";
import { LearningI18n } from "@/components/learn/learning-i18n";
import { AssignmentFormView } from "./assignment-form-view";

export type { AssignmentFormValues } from "./assignment-form-view";

/** Create/edit form of /admin/assignments. Server wrapper: provides the `learning` messages the client form reads. */
export function AssignmentForm(props: ComponentProps<typeof AssignmentFormView>) {
  return (
    <LearningI18n slices={["assessAdmin."]}>
      <AssignmentFormView {...props} />
    </LearningI18n>
  );
}
