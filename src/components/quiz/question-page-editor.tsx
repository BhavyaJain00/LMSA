import type { ComponentProps } from "react";
import { LearningI18n } from "@/components/learn/learning-i18n";
import { QuestionPageEditorView } from "./question-page-editor-view";

/**
 * Full-page question editor (/admin/questions/new and /admin/questions/[id]).
 * Server wrapper: provides the `learning` messages the client editor reads.
 */
export function QuestionPageEditor(props: ComponentProps<typeof QuestionPageEditorView>) {
  return (
    <LearningI18n slices={["quizAdmin."]}>
      <QuestionPageEditorView {...props} />
    </LearningI18n>
  );
}
