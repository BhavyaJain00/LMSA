"use client";

import Link from "next/link";
import { BrandMark } from "@/components/layout/brand-mark";
import { Dropdown } from "@/components/ui/dropdown";
import { Icon } from "@/components/ui/icons";
import { getTheme, setTheme, ThemeToggle } from "@/components/ui/theme-toggle";
import { openCommandPalette } from "@/components/command-palette/events";
import { useT } from "@/i18n/client";
import { cn } from "@/lib/utils";

/** No display class here: callers add `inline-flex` / `hidden sm:inline-flex` themselves (classes are not merged). */
const pill =
  "h-9 items-center justify-center gap-1.5 rounded-full px-4 text-sm font-bold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

/**
 * Glass top bar of the landing page (it has no sidebar): the mark, a few storefront links in the middle,
 * search, theme, "Log in" and "Sign up". Phones keep the mark and "Sign up"; links, search, theme and
 * "Log in" move into a small menu.
 */
export function LandingHeader({
  brand,
  links,
  signupEnabled,
}: {
  brand: { name: string; logoUrl?: string };
  links: { href: string; label: string }[];
  signupEnabled: boolean;
}) {
  const t = useT("shell");
  const tc = useT("common");
  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-border/60 bg-surface/60 backdrop-blur-xl print:hidden">
      <div className="relative mx-auto flex h-16 max-w-7xl items-center gap-2 px-4 sm:px-6 lg:px-8">
        <Link href="/" className="me-auto min-w-0 rounded-lg py-1 focus-visible:outline-2 focus-visible:outline-accent" aria-label={t("header.homeLink", { brand: brand.name })}>
          <BrandMark name={brand.name} logoUrl={brand.logoUrl} nameClassName="text-lg font-bold" />
        </Link>

        {links.length > 0 && (
          <nav aria-label={t("nav.primary")} className="absolute start-1/2 hidden -translate-x-1/2 items-center gap-8 md:flex rtl:translate-x-1/2">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="group relative py-1.5 font-mono text-xs uppercase tracking-widest text-ink-muted transition-colors hover:text-ink"
              >
                {link.label}
                <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-0.5 origin-left scale-x-0 rounded-full bg-accent transition-transform duration-300 group-hover:scale-x-100 rtl:origin-right" />
              </Link>
            ))}
          </nav>
        )}

        <button
          type="button"
          onClick={openCommandPalette}
          className="hidden rounded-full p-2 text-ink-muted hover:bg-surface-2 hover:text-ink sm:inline-flex"
          aria-label={t("header.search")}
          aria-keyshortcuts="Control+K Meta+K"
        >
          <Icon.Search className="size-5" />
        </button>
        <span className="hidden sm:inline-flex">
          <ThemeToggle className="rounded-full" />
        </span>
        <Dropdown
          className="sm:hidden"
          label={t("sidebar.openMenu")}
          trigger={
            <span className="rounded-full p-2 text-ink-muted hover:bg-surface-2 hover:text-ink">
              <Icon.Menu className="size-5" />
            </span>
          }
          items={[
            ...links.map((link) => ({ label: link.label, href: link.href })),
            { label: t("header.search"), icon: <Icon.Search />, onClick: openCommandPalette, separator: links.length > 0 },
            { label: tc("a11y.toggleTheme"), icon: <Icon.Moon />, onClick: () => setTheme(getTheme() === "dark" ? "light" : "dark") },
            ...(signupEnabled ? [{ label: t("header.logIn"), icon: <Icon.LogIn />, href: "/login", separator: true }] : []),
          ]}
        />
        {links.length > 0 && (
          <div className="hidden sm:block md:hidden">
            <Dropdown
              label={t("sidebar.openMenu")}
              trigger={
                <span className="rounded-full p-2 text-ink-muted hover:bg-surface-2 hover:text-ink">
                  <Icon.Menu className="size-5" />
                </span>
              }
              items={links.map((link) => ({ label: link.label, href: link.href }))}
            />
          </div>
        )}
        <Link href="/login" className={cn(pill, "hidden text-ink hover:bg-surface-2 sm:inline-flex")}>
          {t("header.logIn")}
        </Link>
        {signupEnabled ? (
          <Link href="/register" className={cn(pill, "inline-flex bg-accent text-accent-fg shadow-md shadow-accent/25 hover:brightness-110")}>
            {t("header.signUp")}
          </Link>
        ) : (
          <Link href="/login" className={cn(pill, "inline-flex bg-accent text-accent-fg sm:hidden")}>
            {t("header.logIn")}
          </Link>
        )}
      </div>
    </header>
  );
}
