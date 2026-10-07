import Link from "next/link";
import { getSettings } from "@/lib/db/store";
import { Icon } from "@/components/ui/icons";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { LanguageSelect } from "@/components/layout/language-switcher";
import { I18nProvider } from "@/i18n/provider";

/** Key prefixes the auth screens' client components read; the action messages (`errors.`, `flash.`, …) stay on the server. */
const AUTH_CLIENT_KEYS = ["fields.", "links.", "error.", "login.", "register.", "forgot.", "reset.", "twoFactor.", "verify."];

export default async function AuthLayout({ children }: LayoutProps<"/">) {
  const settings = await getSettings();
  return (
    <I18nProvider namespaces={["auth"]} pick={{ auth: AUTH_CLIENT_KEYS }}>
      <div className="flex min-h-screen flex-col bg-surface">
        <header className="flex items-center justify-between gap-3 px-4 py-4 sm:px-6">
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
          <div className="flex shrink-0 items-center gap-1.5">
            <LanguageSelect />
            <ThemeToggle />
          </div>
        </header>
        <main className="flex flex-1 items-center justify-center px-4 pb-16">{children}</main>
      </div>
    </I18nProvider>
  );
}
