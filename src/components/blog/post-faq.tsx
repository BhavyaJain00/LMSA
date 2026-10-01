import type { FaqItem } from "@/lib/types";
import { Markdown } from "@/lib/markdown";
import { Icon } from "@/components/ui/icons";

/**
 * Frequently asked questions of an article as native disclosure widgets
 * (keyboard accessible, no JavaScript). The same items feed the page's
 * FAQPage JSON-LD. Server Component.
 */
export function PostFaq({ items }: { items: FaqItem[] }) {
  if (!items.length) return null;
  return (
    <section aria-labelledby="faq-heading">
      <h2 id="faq-heading" className="text-2xl font-semibold tracking-tight text-ink">
        Frequently asked questions
      </h2>
      <div className="mt-4 divide-y divide-border rounded-card border border-border bg-surface-1">
        {items.map((item, i) => (
          <details key={i} className="group px-4 py-3 sm:px-5" open={i === 0}>
            <summary className="flex cursor-pointer list-none items-start justify-between gap-3 rounded-sm py-1 font-medium text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent [&::-webkit-details-marker]:hidden">
              <h3 className="text-base font-medium">{item.question}</h3>
              <Icon.ChevronDown className="mt-1 size-4 shrink-0 text-ink-muted transition-transform group-open:rotate-180" aria-hidden="true" />
            </summary>
            <Markdown content={item.answer} className="pb-2 pt-1 text-sm text-ink-muted" />
          </details>
        ))}
      </div>
    </section>
  );
}
