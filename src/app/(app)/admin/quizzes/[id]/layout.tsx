import { LearningI18n } from "@/components/learn/learning-i18n";

/** The quiz builder embeds the question editor and the quiz runner (preview), which read `learning` messages. */
export default function AdminQuizLayout({ children }: LayoutProps<"/admin/quizzes/[id]">) {
  return <LearningI18n slices={["quiz.", "quizAdmin.editor.", "quizAdmin.validation."]}>{children}</LearningI18n>;
}
