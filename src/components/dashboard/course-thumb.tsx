import { cn, gradientFor, initials } from "@/lib/utils";

/** Course/batch artwork: the cover image when present, otherwise the card gradient with title initials. */
export function CourseThumb({
  title,
  imageUrl,
  gradient,
  className,
  size = "md",
}: {
  title: string;
  imageUrl?: string;
  gradient?: string;
  className?: string;
  size?: "sm" | "md" | "lg";
}) {
  if (imageUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={imageUrl} alt="" loading="lazy" className={cn("size-full object-cover", className)} />
    );
  }
  return (
    <div
      aria-hidden="true"
      className={cn(
        "flex size-full items-center justify-center bg-linear-to-br font-semibold tracking-tight text-white/95",
        gradientFor(gradient),
        size === "sm" && "text-sm",
        size === "md" && "text-2xl",
        size === "lg" && "text-4xl",
        className,
      )}
    >
      {initials(title)}
    </div>
  );
}
