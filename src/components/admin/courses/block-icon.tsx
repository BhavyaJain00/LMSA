import type { LessonBlockType } from "@/lib/types";
import { Icon } from "@/components/ui/icons";
import { EditorIcon } from "./editor-icons";

/** Icon for a lesson block type (used in the outline rows and the block editor). */
export function BlockIcon({ type, className }: { type: LessonBlockType; className?: string }) {
  switch (type) {
    case "markdown":
      return <Icon.FileText className={className} />;
    case "video":
      return <Icon.Video className={className} />;
    case "audio":
      return <Icon.Audio className={className} />;
    case "pdf":
      return <EditorIcon.Pdf className={className} />;
    case "image":
      return <Icon.Image className={className} />;
    case "file":
      return <Icon.File className={className} />;
    case "code":
      return <Icon.Code className={className} />;
    case "embed":
      return <EditorIcon.Embed className={className} />;
    case "quiz":
      return <Icon.Question className={className} />;
    case "assignment":
      return <Icon.ClipboardList className={className} />;
    case "exercise":
      return <Icon.Terminal className={className} />;
    case "callout":
      return <EditorIcon.Callout className={className} />;
  }
}
