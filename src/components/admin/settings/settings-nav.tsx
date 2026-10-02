"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "@/components/ui/icons";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";

type NavItemId =
  | "general" | "branding" | "seo" | "features" | "learning" | "video" | "storage" | "ai" | "api" | "pwa"
  | "blog" | "leads" | "analytics" | "affiliates"
  | "categories" | "badges" | "gamification" | "rubrics"
  | "members" | "teams" | "marketplace" | "security" | "loginActivity"
  | "email" | "broadcasts" | "sequences" | "outbox"
  | "payments" | "transactions" | "coupons" | "plans" | "taxes" | "upsells"
  | "sidebar" | "legal" | "audit" | "errors" | "data";

type NavGroupId = "system" | "marketing" | "course" | "users" | "communication" | "payment" | "customization" | "legal" | "data";

interface NavLink {
  id: NavItemId;
  href: string;
  icon: IconName;
}

/** Grouped settings navigation (Frappe's settings dialog sidebar, as routes). Labels: `settingsNav.groups.*` / `settingsNav.items.*`. */
export const SETTINGS_NAV: { group: NavGroupId; items: NavLink[] }[] = [
  {
    group: "system",
    items: [
      { id: "general", href: "/admin/settings/general", icon: "Settings" },
      { id: "branding", href: "/admin/settings/branding", icon: "Palette" },
      { id: "seo", href: "/admin/settings/seo", icon: "Search" },
      { id: "features", href: "/admin/settings/features", icon: "Sliders" },
      { id: "learning", href: "/admin/settings/learning", icon: "GraduationCap" },
      { id: "video", href: "/admin/settings/video", icon: "Video" },
      { id: "storage", href: "/admin/settings/storage", icon: "Database" },
      { id: "ai", href: "/admin/settings/ai", icon: "Sparkles" },
      { id: "api", href: "/admin/settings/api", icon: "Code" },
      { id: "pwa", href: "/admin/settings/pwa", icon: "Smartphone" },
    ],
  },
  {
    group: "marketing",
    items: [
      { id: "blog", href: "/admin/blog", icon: "FileText" },
      { id: "leads", href: "/admin/leads", icon: "Inbox" },
      { id: "analytics", href: "/admin/analytics", icon: "BarChart" },
      { id: "affiliates", href: "/admin/affiliates", icon: "Handshake" },
    ],
  },
  {
    group: "course",
    items: [
      { id: "categories", href: "/admin/settings/categories", icon: "Tag" },
      { id: "badges", href: "/admin/settings/badges", icon: "Award" },
      { id: "gamification", href: "/admin/settings/gamification", icon: "Trophy" },
      { id: "rubrics", href: "/admin/rubrics", icon: "ClipboardList" },
    ],
  },
  {
    group: "users",
    items: [
      { id: "members", href: "/admin/members", icon: "Users" },
      { id: "teams", href: "/admin/teams", icon: "Building" },
      { id: "marketplace", href: "/admin/marketplace", icon: "Presentation" },
      { id: "security", href: "/admin/settings/security", icon: "ShieldCheck" },
      { id: "loginActivity", href: "/admin/security", icon: "Shield" },
    ],
  },
  {
    group: "communication",
    items: [
      { id: "email", href: "/admin/settings/email", icon: "Mail" },
      { id: "broadcasts", href: "/admin/broadcasts", icon: "Megaphone" },
      { id: "sequences", href: "/admin/sequences", icon: "Zap" },
      { id: "outbox", href: "/admin/emails", icon: "Send" },
    ],
  },
  {
    group: "payment",
    items: [
      { id: "payments", href: "/admin/settings/payments", icon: "CreditCard" },
      { id: "transactions", href: "/admin/settings/transactions", icon: "Receipt" },
      { id: "coupons", href: "/admin/settings/coupons", icon: "Ticket" },
      { id: "plans", href: "/admin/settings/plans", icon: "Layers" },
      { id: "taxes", href: "/admin/settings/taxes", icon: "Percent" },
      { id: "upsells", href: "/admin/upsells", icon: "TrendingUp" },
    ],
  },
  {
    group: "customization",
    items: [{ id: "sidebar", href: "/admin/settings/sidebar", icon: "Menu" }],
  },
  {
    group: "legal",
    items: [
      { id: "legal", href: "/admin/settings/legal", icon: "ShieldCheck" },
      { id: "audit", href: "/admin/audit", icon: "ListChecks" },
      { id: "errors", href: "/admin/errors", icon: "AlertTriangle" },
    ],
  },
  {
    group: "data",
    items: [{ id: "data", href: "/admin/settings/data", icon: "Database" }],
  },
];

export function SettingsNav() {
  const t = useT("admin");
  const pathname = usePathname();
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  const all = SETTINGS_NAV.flatMap((g) => g.items);

  return (
    <>
      {/* Phones & tablets: horizontally scrollable pills */}
      <nav aria-label={t("settingsNav.label")} className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 lg:hidden">
        {all.map((item) => {
          const active = isActive(item.href);
          const IconCmp = Icon[item.icon];
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
                active ? "border-transparent bg-ink text-surface-1" : "border-border bg-surface-1 text-ink-muted hover:text-ink",
              )}
            >
              <IconCmp className="size-4" />
              {t(`settingsNav.items.${item.id}`)}
            </Link>
          );
        })}
      </nav>

      {/* Desktop: grouped vertical list */}
      <nav aria-label={t("settingsNav.label")} className="hidden lg:block">
        <div className="space-y-5">
          {SETTINGS_NAV.map((group) => (
            <div key={group.group}>
              <p className="mb-1.5 px-2.5 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{t(`settingsNav.groups.${group.group}`)}</p>
              <ul className="space-y-0.5">
                {group.items.map((item) => {
                  const active = isActive(item.href);
                  const IconCmp = Icon[item.icon];
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm transition-colors",
                          active ? "bg-surface-1 font-medium text-ink shadow-sm ring-1 ring-border" : "text-ink-muted hover:bg-surface-2 hover:text-ink",
                        )}
                      >
                        <IconCmp className={cn("size-4", active ? "text-accent" : "text-ink-faint")} />
                        {t(`settingsNav.items.${item.id}`)}
                        {item.href === "/admin/members" && <Icon.ArrowUpRight className="ml-auto size-3.5 text-ink-faint" />}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </nav>
    </>
  );
}
