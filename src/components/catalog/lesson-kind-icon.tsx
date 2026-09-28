import { Icon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";
import { lessonKindLabels, type LessonKind } from "./format";

const icons: Record<LessonKind, (props: { className?: string }) => React.ReactNode> = {
  video: (p) => <Icon.Video {...p} aria-hidden="true" />,
  quiz: (p) => <Icon.Question {...p} aria-hidden="true" />,
  assignment: (p) => <Icon.ClipboardList {...p} aria-hidden="true" />,
  exercise: (p) => <Icon.Code {...p} aria-hidden="true" />,
  text: (p) => <Icon.FileText {...p} aria-hidden="true" />,
};

/** Content-type icon for an outline row (video / quiz / assignment / exercise / text). */
export function LessonKindIcon({ kind, className }: { kind: LessonKind; className?: string }) {
  const render = icons[kind];
  return (
    <span className="inline-flex shrink-0" title={lessonKindLabels[kind]}>
      {render({ className: cn("size-4", className) })}
      <span className="sr-only">{lessonKindLabels[kind]}:</span>
    </span>
  );
}
