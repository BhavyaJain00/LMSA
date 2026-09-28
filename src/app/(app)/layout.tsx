import { AppShell } from "@/components/layout/app-shell";
import { CommandPalette } from "@/components/command-palette/command-palette";
import { buildPaletteConfig } from "@/components/command-palette/config";
import { getCurrentPublicUser } from "@/lib/auth/session";
import { getSettings } from "@/lib/db/store";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const [user, settings] = await Promise.all([getCurrentPublicUser(), getSettings()]);
  const palette = buildPaletteConfig(user, settings);
  return (
    <>
      <AppShell>{children}</AppShell>
      <CommandPalette {...palette} />
    </>
  );
}
