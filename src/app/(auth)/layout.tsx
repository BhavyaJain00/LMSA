import Link from "next/link";
import { getSettings } from "@/lib/db/store";
import { Icon } from "@/components/ui/icons";
import { ThemeToggle } from "@/components/ui/theme-toggle";

export default async function AuthLayout({ children }: LayoutProps<"/">) {
  const settings = await getSettings();
  return (
    <div className="flex min-h-screen flex-col bg-surface">
      <header className="flex items-center justify-between px-6 py-4">
        <Link href="/" className="flex items-center gap-2.5">
          {settings.brand.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={settings.brand.logoUrl} alt={settings.brand.name} className="size-8 rounded-lg object-contain" />
          ) : (
            <span className="flex size-8 items-center justify-center rounded-lg bg-accent text-accent-fg">
              <Icon.GraduationCap className="size-5" />
            </span>
          )}
          <span className="text-base font-semibold tracking-tight text-ink">{settings.brand.name}</span>
        </Link>
        <ThemeToggle />
      </header>
      <main className="flex flex-1 items-center justify-center px-4 pb-16">{children}</main>
    </div>
  );
}
