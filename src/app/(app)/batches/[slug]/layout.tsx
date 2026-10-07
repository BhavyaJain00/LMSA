import { PlayerI18n } from "@/components/player/player-i18n";

/** Live class recordings on the batch page use the player, whose messages the root layout leaves out. */
export default function BatchDetailLayout({ children }: LayoutProps<"/batches/[slug]">) {
  return <PlayerI18n>{children}</PlayerI18n>;
}
