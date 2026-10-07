import { PlayerI18n } from "@/components/player/player-i18n";

/**
 * The lesson editor's block previews and the transcript editor use the player, whose messages
 * the root layout leaves out. Pages below re-check permissions themselves.
 */
export default function LessonEditorLayout({ children }: LayoutProps<"/admin/courses/[id]/lessons/[lessonId]">) {
  return <PlayerI18n>{children}</PlayerI18n>;
}
