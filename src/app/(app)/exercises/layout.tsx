import { LearningI18n } from "@/components/learn/learning-i18n";

/** The exercise pages render the code runner and test results (client components) that read `learning` messages. */
export default function ExercisesLayout({ children }: LayoutProps<"/exercises">) {
  return <LearningI18n slices={["exercise."]}>{children}</LearningI18n>;
}
