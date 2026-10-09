import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "@/components/ui/icons";

/** One section of the learner home: a bold heading, an optional one-line description and an optional "View all →" link. */
export function HomeSection({
  id,
  title,
  description,
  href,
  linkLabel,
  children,
}: {
  id: string;
  title: ReactNode;
  description?: ReactNode;
  href?: string;
  linkLabel?: string;
  children: ReactNode;
}) {
  const headingId = `${id}-title`;
  return (
    <section id={id} aria-labelledby={headingId} className="min-w-0">
      <div className="mb-4 flex items-end justify-between gap-4">
        <div className="min-w-0">
          <h2 id={headingId} className="text-heading font-bold text-ink">
            {title}
          </h2>
          {description && <p className="mt-0.5 text-meta text-ink-faint">{description}</p>}
        </div>
        {href && linkLabel && (
          <Link href={href} className="tap-target inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-accent hover:underline">
            {linkLabel}
            <Icon.ArrowRight className="size-4 rtl:rotate-180" aria-hidden="true" />
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}
