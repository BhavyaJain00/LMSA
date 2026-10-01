"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useState, useSyncExternalStore, type ReactNode } from "react";
import type { NavSection } from "@/lib/nav";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icons";
import { useT } from "@/i18n/client";

interface SidebarState {
  mobileOpen: boolean;
  setMobileOpen: (v: boolean) => void;
  collapsed: boolean;
  setCollapsed: (v: boolean) => void;
}

const SidebarContext = createContext<SidebarState | null>(null);

export function useSidebar(): SidebarState {
  const ctx = useContext(SidebarContext);
  if (!ctx) throw new Error("useSidebar must be used within SidebarProvider");
  return ctx;
}

const COLLAPSE_KEY = "ll-sidebar";
const COLLAPSE_EVENT = "ll-sidebar-change";

function subscribeCollapsed(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(COLLAPSE_EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(COLLAPSE_EVENT, callback);
  };
}

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === "collapsed";
  } catch {
    return false;
  }
}

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  // Persisted preference read through an external store so the server render (expanded) hydrates cleanly.
  const collapsed = useSyncExternalStore(subscribeCollapsed, readCollapsed, () => false);

  const setCollapsed = useCallback((v: boolean) => {
    try {
      localStorage.setItem(COLLAPSE_KEY, v ? "collapsed" : "expanded");
    } catch {
      /* ignore */
    }
    window.dispatchEvent(new Event(COLLAPSE_EVENT));
  }, []);

  return <SidebarContext.Provider value={{ mobileOpen, setMobileOpen, collapsed, setCollapsed }}>{children}</SidebarContext.Provider>;
}

export function Sidebar({ sections, brand }: { sections: NavSection[]; brand: { name: string; logoUrl?: string } }) {
  const { mobileOpen, setMobileOpen, collapsed, setCollapsed } = useSidebar();
  const pathname = usePathname();
  const t = useT("shell");
  const close = () => setMobileOpen(false);

  const nav = (
    <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-3 scrollbar-thin" aria-label={t("nav.main")}>
      {sections.map((section) => (
        <div key={section.key}>
          {section.title && !collapsed && <p className="mb-1.5 px-2.5 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{section.title}</p>}
          {section.title && collapsed && <div className="mx-2 mb-2 border-t border-border" />}
          <ul className="space-y-0.5">
            {section.items.map((item) => {
              const active = item.prefix ? pathname === item.href || pathname.startsWith(item.href + "/") : pathname === item.href;
              const IconCmp = Icon[item.icon] ?? Icon.Dot;
              const external = /^https?:\/\//.test(item.href);
              const content = (
                <>
                  <IconCmp className="size-[18px] shrink-0" />
                  {!collapsed && <span className="truncate">{item.label}</span>}
                  {!collapsed && item.badge ? (
                    <span className="ms-auto rounded-full bg-accent px-1.5 py-px text-[10px] font-semibold text-accent-fg">{item.badge > 99 ? "99+" : item.badge}</span>
                  ) : null}
                  {collapsed && item.badge ? <span className="absolute inset-e-1.5 top-1.5 size-2 rounded-full bg-accent" /> : null}
                </>
              );
              const classes = cn(
                "relative flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors",
                active ? "bg-accent/10 text-accent" : "text-ink-muted hover:bg-surface-2 hover:text-ink",
                collapsed && "justify-center px-0",
              );
              return (
                <li key={item.href}>
                  {external ? (
                    <a href={item.href} target="_blank" rel="noopener noreferrer" className={classes} title={collapsed ? item.label : undefined} onClick={close}>
                      {content}
                    </a>
                  ) : (
                    <Link href={item.href} className={classes} aria-current={active ? "page" : undefined} title={collapsed ? item.label : undefined} onClick={close}>
                      {content}
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );

  const brandBlock = (
    <Link href="/" onClick={close} className={cn("flex items-center gap-2.5 px-4 py-4", collapsed && "justify-center px-0")}>
      {brand.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={brand.logoUrl} alt={brand.name} className="size-8 rounded-lg object-contain" />
      ) : (
        <span className="flex size-8 items-center justify-center rounded-lg bg-accent text-accent-fg">
          <Icon.GraduationCap className="size-5" />
        </span>
      )}
      {!collapsed && <span className="truncate text-base font-semibold tracking-tight text-ink">{brand.name}</span>}
    </Link>
  );

  return (
    <>
      {/* Desktop */}
      <aside
        className={cn(
          "sticky top-0 hidden h-screen shrink-0 flex-col border-e border-border bg-surface-1 transition-[width] duration-200 lg:flex",
          collapsed ? "w-16" : "w-60",
        )}
      >
        {brandBlock}
        {nav}
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          className="flex items-center justify-center gap-2 border-t border-border px-3 py-2.5 text-xs text-ink-faint hover:text-ink"
          aria-label={collapsed ? t("sidebar.expand") : t("sidebar.collapse")}
        >
          {collapsed ? <Icon.ChevronRight className="size-4 rtl:rotate-180" /> : <Icon.ChevronLeft className="size-4 rtl:rotate-180" />}
          {!collapsed && t("sidebar.collapseShort")}
        </button>
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label={t("nav.main")}>
          <div className="absolute inset-0 bg-black/50" onClick={close} />
          <aside className="absolute inset-y-0 inset-s-0 flex w-72 max-w-[85vw] flex-col bg-surface-1 shadow-pop animate-fade-in">
            <div className="flex items-center justify-between pe-2">
              {brandBlock}
              <button type="button" onClick={close} className="rounded-lg p-2 text-ink-muted hover:bg-surface-2" aria-label={t("sidebar.closeMenu")}>
                <Icon.X className="size-5" />
              </button>
            </div>
            {nav}
          </aside>
        </div>
      )}
    </>
  );
}
