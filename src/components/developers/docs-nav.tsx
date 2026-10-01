import { Icon } from "@/components/ui/icons";

export interface DocsNavItem {
  href: string;
  label: string;
  children?: DocsNavItem[];
}

function NavList({ items, nested = false }: { items: readonly DocsNavItem[]; nested?: boolean }) {
  return (
    <ol className={nested ? "mt-1 space-y-1 pl-3" : "space-y-1.5 border-l border-border"}>
      {items.map((item) => (
        <li key={item.href}>
          <a
            href={item.href}
            className={
              nested
                ? "block rounded py-0.5 text-[13px] text-ink-faint hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                : "-ml-px block border-l border-transparent pl-3 text-ink-muted hover:border-ink hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            }
          >
            {item.label}
          </a>
          {item.children && item.children.length > 0 && <NavList items={item.children} nested />}
        </li>
      ))}
    </ol>
  );
}

/**
 * Table of contents of the developer docs: a sticky sidebar on wide
 * screens, a collapsible "On this page" panel on phones.
 */
export function DocsNav({ items }: { items: readonly DocsNavItem[] }) {
  return (
    <>
      <details className="group mb-6 rounded-card border border-border bg-surface-1 lg:hidden">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-sm font-medium text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 [&::-webkit-details-marker]:hidden">
          On this page
          <Icon.ChevronDown className="size-4 text-ink-faint transition-transform group-open:rotate-180" />
        </summary>
        <nav aria-label="Developer docs, on this page" className="border-t border-border px-4 py-3 text-sm">
          <NavList items={items} />
        </nav>
      </details>
      <nav aria-label="Developer docs" className="hidden text-sm lg:sticky lg:top-20 lg:block lg:max-h-[calc(100vh-6rem)] lg:self-start lg:overflow-y-auto lg:pb-6">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">On this page</p>
        <NavList items={items} />
      </nav>
    </>
  );
}
