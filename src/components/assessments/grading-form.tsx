import type { ComponentProps } from "react";
import { LearningI18n } from "@/components/learn/learning-i18n";
import { GradingFormView } from "./grading-form-view";

/** Grade + comments form of an assignment submission. Server wrapper: provides the `learning` messages the client form reads. */
export function GradingForm(props: ComponentProps<typeof GradingFormView>) {
  return (
    <LearningI18n slices={["assessAdmin."]}>
      <GradingFormView {...props} />
    </LearningI18n>
  );
}
