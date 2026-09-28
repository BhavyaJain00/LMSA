import { cn, gradientFor } from "@/lib/utils";

/** Small course thumbnail: the cover image, or the card gradient with initials. */
export function CourseThumb({ title, imageUrl, gradient, className }: { title: string; imageUrl?: string; gradient: string; className?: string }) {
  if (imageUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={imageUrl} alt="" className={cn("aspect-[750/422] shrink-0 rounded-lg border border-border object-cover", className)} loading="lazy" />;
  }
  const initials = title
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
  return (
    <span className={cn("flex aspect-[750/422] shrink-0 items-center justify-center rounded-lg bg-gradient-to-tr text-sm font-extrabold text-white", gradientFor(gradient), className)} aria-hidden="true">
      {initials}
    </span>
  );
}
