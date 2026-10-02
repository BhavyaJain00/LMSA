import { LearningI18n } from "@/components/learn/learning-i18n";

/** The standalone quiz pages (`/quiz/[id]`, `/quiz/submissions/[id]`) render the quiz runner and results on the client. */
export default function QuizLayout({ children }: LayoutProps<"/quiz">) {
  return <LearningI18n slices={["quiz."]}>{children}</LearningI18n>;
}
