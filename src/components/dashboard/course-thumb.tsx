import { CoverImage } from "@/components/catalog/cover-image";
import { cn, gradientFor, initials } from "@/lib/utils";

/**
 * Course/batch artwork: the card gradient with the title initials, with the cover image on top when there is one.
 * A cover that fails to load removes itself (see `CoverImage`), so the artwork shows instead of a broken image.
 * Fills its parent, which sets the size.
 */
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
  return (
    <div className={cn("relative size-full overflow-hidden", className)}>
      <div
        aria-hidden="true"
        className={cn(
          "absolute inset-0 flex items-center justify-center bg-linear-to-br font-semibold tracking-tight text-white/95",
          gradientFor(gradient),
          size === "sm" && "text-sm",
          size === "md" && "text-2xl",
          size === "lg" && "text-4xl",
        )}
      >
        {initials(title.replace(/[^\p{L}\p{N}\s]/gu, " "))}
      </div>
      {imageUrl && <CoverImage src={imageUrl} alt="" className="absolute inset-0 size-full object-cover" />}
    </div>
  );
}
