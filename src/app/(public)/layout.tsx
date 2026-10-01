import Link from "next/link";
import { getSettings } from "@/lib/db/store";
import { AnalyticsBeacon } from "@/components/analytics/analytics-beacon";
import { Icon } from "@/components/ui/icons";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import "./certificate-print.css";

/**
 * Minimal, print-friendly layout for public pages (certificate verification).
 * The header and footer are hidden when printing.
 */
export default async function PublicLayout({ children }: LayoutProps<"/">) {
  const settings = await getSettings();
  return (
    <div className="flex min-h-screen flex-col bg-surface">
      <header className="public-chrome flex items-center justify-between gap-3 border-b border-border bg-surface-1/80 px-4 py-3 backdrop-blur sm:px-6">
        <Link href="/" className="flex min-w-0 items-center gap-2.5">
          {settings.brand.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={settings.brand.logoUrl} alt={settings.brand.name} className="size-8 rounded-lg object-contain" />
          ) : (
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-fg">
              <Icon.GraduationCap className="size-5" />
            </span>
          )}
          <span className="truncate text-base font-semibold tracking-tight text-ink">{settings.brand.name}</span>
        </Link>
        <div className="flex items-center gap-1">
          <Link href="/courses" className="hidden rounded-lg px-3 py-1.5 text-sm font-medium text-ink-muted hover:bg-surface-2 hover:text-ink sm:inline-flex">
            Browse courses
          </Link>
          <ThemeToggle />
        </div>
      </header>
      <main className="public-main mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-10">{children}</main>
      <footer className="public-chrome border-t border-border px-6 py-4 text-center text-xs text-ink-faint">
        {settings.brand.footerText || `© ${settings.brand.name}`}
      </footer>
      <AnalyticsBeacon />
    </div>
  );
}
