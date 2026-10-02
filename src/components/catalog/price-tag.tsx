import type { Course } from "@/lib/types";
import { cn, formatPrice } from "@/lib/utils";
import { getFormatter, getT } from "@/i18n/server";

type Priced = Pick<Course, "paidCourse" | "price" | "currency">;

export function isPaidCourse(course: Priced): boolean {
  return course.paidCourse && course.price > 0;
}

/** "Free" or the formatted amount; pass the translated free label and the active locale on localized pages. */
export function coursePriceLabel(course: Priced, freeLabel = "Free", locale?: string): string {
  return isPaidCourse(course) ? formatPrice(course.price, course.currency, freeLabel, locale) : freeLabel;
}

/** Course price ("Free" or the formatted amount). */
export async function PriceTag({ course, size = "sm", className }: { course: Priced; size?: "sm" | "md" | "xl"; className?: string }) {
  const [t, f] = await Promise.all([getT("public"), getFormatter()]);
  const paid = isPaidCourse(course);
  return (
    <span
      className={cn(
        "font-semibold tabular-nums",
        size === "sm" && "text-sm",
        size === "md" && "text-base",
        size === "xl" && "text-3xl tracking-tight",
        paid ? "text-ink" : "text-success",
        className,
      )}
    >
      {coursePriceLabel(course, t("catalog.free"), f.locale)}
    </span>
  );
}
