"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

interface NavLink {
  label: string;
  href: string;
  icon: IconName;
}

/** Grouped settings navigation (Frappe's settings dialog sidebar, as routes). */
export const SETTINGS_NAV: { group: string; items: NavLink[] }[] = [
  {
    group: "System configuration",
    items: [
      { label: "General", href: "/admin/settings/general", icon: "Settings" },
      { label: "Branding", href: "/admin/settings/branding", icon: "Palette" },
      { label: "SEO", href: "/admin/settings/seo", icon: "Search" },
      { label: "Features", href: "/admin/settings/features", icon: "Sliders" },
      { label: "Learning", href: "/admin/settings/learning", icon: "GraduationCap" },
      { label: "Video", href: "/admin/settings/video", icon: "Video" },
      { label: "Storage & video", href: "/admin/settings/storage", icon: "Database" },
      { label: "AI tutor", href: "/admin/settings/ai", icon: "Sparkles" },
      { label: "API & webhooks", href: "/admin/settings/api", icon: "Code" },
      { label: "Installable app", href: "/admin/settings/pwa", icon: "Smartphone" },
    ],
  },
  {
    group: "Content & marketing",
    items: [
      { label: "Blog", href: "/admin/blog", icon: "FileText" },
      { label: "Leads", href: "/admin/leads", icon: "Inbox" },
      { label: "Analytics", href: "/admin/analytics", icon: "BarChart" },
      { label: "Affiliates", href: "/admin/affiliates", icon: "Handshake" },
    ],
  },
  {
    group: "Course configuration",
    items: [
      { label: "Categories", href: "/admin/settings/categories", icon: "Tag" },
      { label: "Badges", href: "/admin/settings/badges", icon: "Award" },
      { label: "Points & leaderboard", href: "/admin/settings/gamification", icon: "Trophy" },
      { label: "Rubrics", href: "/admin/rubrics", icon: "ClipboardList" },
    ],
  },
  {
    group: "User management",
    items: [
      { label: "Members", href: "/admin/members", icon: "Users" },
      { label: "Teams", href: "/admin/teams", icon: "Building" },
      { label: "Instructors & payouts", href: "/admin/marketplace", icon: "Presentation" },
      { label: "Security", href: "/admin/settings/security", icon: "ShieldCheck" },
      { label: "Login activity", href: "/admin/security", icon: "Shield" },
    ],
  },
  {
    group: "Communication",
    items: [
      { label: "Email", href: "/admin/settings/email", icon: "Mail" },
      { label: "Broadcasts", href: "/admin/broadcasts", icon: "Megaphone" },
      { label: "Email sequences", href: "/admin/sequences", icon: "Zap" },
      { label: "Outbox", href: "/admin/emails", icon: "Send" },
    ],
  },
  {
    group: "Payment",
    items: [
      { label: "Payments", href: "/admin/settings/payments", icon: "CreditCard" },
      { label: "Transactions", href: "/admin/settings/transactions", icon: "Receipt" },
      { label: "Coupons", href: "/admin/settings/coupons", icon: "Ticket" },
      { label: "Plans, bundles & installments", href: "/admin/settings/plans", icon: "Layers" },
      { label: "Taxes & currencies", href: "/admin/settings/taxes", icon: "Percent" },
      { label: "Upsells", href: "/admin/upsells", icon: "TrendingUp" },
    ],
  },
  {
    group: "Customization",
    items: [{ label: "Sidebar", href: "/admin/settings/sidebar", icon: "Menu" }],
  },
  {
    group: "Legal & compliance",
    items: [
      { label: "Legal pages", href: "/admin/settings/legal", icon: "ShieldCheck" },
      { label: "Audit log", href: "/admin/audit", icon: "ListChecks" },
      { label: "Error log", href: "/admin/errors", icon: "AlertTriangle" },
    ],
  },
  {
    group: "Data",
    items: [{ label: "Backup & restore", href: "/admin/settings/data", icon: "Database" }],
  },
];

export function SettingsNav() {
  const pathname = usePathname();
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  const all = SETTINGS_NAV.flatMap((g) => g.items);

  return (
    <>
      {/* Phones & tablets: horizontally scrollable pills */}
      <nav aria-label="Settings sections" className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 lg:hidden">
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
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Desktop: grouped vertical list */}
      <nav aria-label="Settings sections" className="hidden lg:block">
        <div className="space-y-5">
          {SETTINGS_NAV.map((group) => (
            <div key={group.group}>
              <p className="mb-1.5 px-2.5 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{group.group}</p>
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
                        {item.label}
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
