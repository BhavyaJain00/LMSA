import { LearningI18n } from "@/components/learn/learning-i18n";

/** `/assignments/[id]` renders the assignment panel (a client component) that reads `learning` messages. */
export default function AssignmentsLayout({ children }: LayoutProps<"/assignments">) {
  return <LearningI18n slices={["assignment."]}>{children}</LearningI18n>;
}
