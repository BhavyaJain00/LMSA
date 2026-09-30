import type { ReactNode } from "react";
import type { CardGradient } from "@/lib/types";
import { cn, gradientFor, initials } from "@/lib/utils";

/**
 * Course artwork: the cover image when there is one, otherwise the course's
 * card gradient with the title initials as a monogram (Frappe card_gradient).
 *
 * Deliberate exception to the "semantic tokens only" rule: the card gradients
 * (`gradientClasses` in src/lib/utils.ts) are a fixed, theme-independent
 * palette, so the shade, dot pattern and monogram drawn on top of them use
 * fixed black/white as well. Theme tokens (ink, surface) flip in dark mode and
 * would lose contrast against the same gradient.
 */
export function CourseCover({
  title,
  imageUrl,
  gradient,
  className,
  children,
  variant = "card",
  alt,
  priority,
}: {
  title: string;
  imageUrl?: string | null;
  gradient?: CardGradient | string;
  className?: string;
  /** Overlay content (badges) rendered in the top-left corner. */
  children?: ReactNode;
  variant?: "card" | "hero";
  /** Alt text for the image; empty when the title is already visible nearby. */
  alt?: string;
  /**
   * Covers are lazy-loaded by default. Above the fold, "eager" loads the image
   * with the page and "high" also marks it as the page's largest image (LCP).
   */
  priority?: "high" | "eager";
}) {
  const monogram = initials(title.replace(/[^\p{L}\p{N}\s]/gu, " "));
  return (
    <div className={cn("relative isolate overflow-hidden bg-surface-3", className)}>
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageUrl}
          alt={alt ?? ""}
          loading={priority ? "eager" : "lazy"}
          fetchPriority={priority === "high" ? "high" : undefined}
          decoding="async"
          className="absolute inset-0 size-full object-cover"
        />
      ) : (
        <div className={cn("absolute inset-0 bg-linear-to-br", gradientFor(gradient))} aria-hidden="true">
          <div className="absolute inset-0 bg-linear-to-tr from-black/45 via-black/10 to-transparent" />
          <div
            className="absolute inset-0 text-white opacity-[0.14]"
            style={{ backgroundImage: "radial-gradient(currentColor 1.3px, transparent 1.4px)", backgroundSize: "18px 18px" }}
          />
          <div className="absolute inset-0 flex items-center justify-center">
            <span
              className={cn(
                "select-none font-extrabold tracking-tight text-white/95 drop-shadow-sm",
                variant === "hero" ? "text-7xl sm:text-8xl" : "text-5xl",
              )}
            >
              {monogram}
            </span>
          </div>
          <span className="absolute -bottom-6 -right-4 select-none text-[7rem] font-black leading-none text-white/10">{monogram}</span>
        </div>
      )}
      {children && <div className="absolute left-3 top-3 z-10 flex flex-wrap gap-1.5">{children}</div>}
    </div>
  );
}
