import type { ComponentProps } from "react";
import { LearningI18n } from "@/components/learn/learning-i18n";
import { NewQuizFormView } from "./new-quiz-form-view";

/** "New quiz" form of /admin/quizzes/new. Server wrapper: provides the `learning` messages the client form reads. */
export function NewQuizForm(props: ComponentProps<typeof NewQuizFormView>) {
  return (
    <LearningI18n slices={["quizAdmin.newQuiz."]}>
      <NewQuizFormView {...props} />
    </LearningI18n>
  );
}
