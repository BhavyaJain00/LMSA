import type { Course } from "@/lib/types";
import { cn, formatPrice } from "@/lib/utils";

type Priced = Pick<Course, "paidCourse" | "price" | "currency">;

export function isPaidCourse(course: Priced): boolean {
  return course.paidCourse && course.price > 0;
}

export function coursePriceLabel(course: Priced): string {
  return isPaidCourse(course) ? formatPrice(course.price, course.currency) : "Free";
}

/** Course price ("Free" or the formatted amount). */
export function PriceTag({ course, size = "sm", className }: { course: Priced; size?: "sm" | "md" | "xl"; className?: string }) {
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
      {coursePriceLabel(course)}
    </span>
  );
}
