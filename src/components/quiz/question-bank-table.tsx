import type { ComponentProps } from "react";
import { LearningI18n } from "@/components/learn/learning-i18n";
import { NewQuestionButtonView, QuestionBankTableView } from "./question-bank-table-view";

/** Messages of the question bank, its dialog and the question editor. */
const SLICES = ["quizAdmin."];

/** "New question" header button with its own dialog. Server wrapper: provides the `learning` messages it reads. */
export function NewQuestionButton(props: ComponentProps<typeof NewQuestionButtonView>) {
  return (
    <LearningI18n slices={SLICES}>
      <NewQuestionButtonView {...props} />
    </LearningI18n>
  );
}

/** Question bank list of /admin/questions. Server wrapper: provides the `learning` messages the client table reads. */
export function QuestionBankTable(props: ComponentProps<typeof QuestionBankTableView>) {
  return (
    <LearningI18n slices={SLICES}>
      <QuestionBankTableView {...props} />
    </LearningI18n>
  );
}
