import { Tabs } from "@/components/ui/tabs";
import { Icon } from "@/components/ui/icons";

/** Sub-navigation shared by the broadcast and sequence admin pages. */
export function BroadcastsNav({ className }: { className?: string }) {
  return (
    <Tabs
      className={className}
      items={[
        { label: "Broadcasts", href: "/admin/broadcasts", icon: <Icon.Megaphone className="size-4" /> },
        { label: "Sequences", href: "/admin/sequences", icon: <Icon.Zap className="size-4" /> },
        { label: "Audience", href: "/admin/broadcasts/audience", icon: <Icon.Users className="size-4" /> },
        { label: "Tracking", href: "/admin/broadcasts/tracking", icon: <Icon.BarChart className="size-4" /> },
      ]}
    />
  );
}
