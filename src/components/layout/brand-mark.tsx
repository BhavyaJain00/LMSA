import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icons";

const SIZES = {
  sm: { tile: "size-7 rounded-md", icon: "size-4", name: "text-sm" },
  md: { tile: "size-8 rounded-lg", icon: "size-5", name: "text-base" },
} as const;

/**
 * The site's logo: the uploaded logo, or the graduation-cap tile in the accent colour, optionally followed by the
 * site name. One mark for every shell (sidebar, guest top bar, lesson player, sign-in screens). Purely
 * presentational, so it renders in server and client components alike; wrap it in a link where needed.
 */
export function BrandMark({
  name,
  logoUrl,
  size = "md",
  showName = true,
  nameClassName,
  className,
}: {
  name: string;
  logoUrl?: string;
  size?: keyof typeof SIZES;
  /** Show the site name next to the mark (`false` for icon-only places such as the collapsed sidebar). */
  showName?: boolean;
  /** Extra classes for the name, e.g. `hidden md:inline` to hide it on phones. */
  nameClassName?: string;
  className?: string;
}) {
  const s = SIZES[size];
  return (
    <span className={cn("flex min-w-0 items-center gap-2.5", className)}>
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logoUrl} alt={showName ? "" : name} className={cn(s.tile, "shrink-0 object-contain")} />
      ) : (
        <span className={cn(s.tile, "flex shrink-0 items-center justify-center bg-accent text-accent-fg")} aria-hidden={showName || undefined}>
          <Icon.GraduationCap className={s.icon} />
        </span>
      )}
      {showName && <span className={cn("truncate font-semibold tracking-tight text-ink", s.name, nameClassName)}>{name}</span>}
    </span>
  );
}
