import { PlayerI18n } from "@/components/player/player-i18n";

/** The course page's preview and sales videos use the player, whose messages the root layout leaves out. */
export default function CourseDetailLayout({ children }: LayoutProps<"/courses/[slug]">) {
  return <PlayerI18n>{children}</PlayerI18n>;
}
