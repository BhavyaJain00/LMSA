import { cn, initials } from "@/lib/utils";

/** Rendered size in CSS pixels of each avatar size (for the img width/height attributes). */
const pixels = { xs: 24, sm: 32, md: 40, lg: 56, xl: 80, "2xl": 112 } as const;

const sizes = {
  xs: "size-6 text-micro tracking-tighter",
  sm: "size-8 text-xs",
  md: "size-10 text-sm",
  lg: "size-14 text-base",
  xl: "size-20 text-xl",
  "2xl": "size-28 text-3xl",
} as const;

/** Deterministic pastel background for users without an avatar. */
function colorFor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return `hsl(${hue} 55% 45%)`;
}

export function Avatar({
  name,
  src,
  size = "md",
  className,
  ring,
}: {
  name: string;
  src?: string | null;
  size?: keyof typeof sizes;
  className?: string;
  ring?: boolean;
}) {
  const classes = cn(
    "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold text-white select-none",
    sizes[size],
    ring && "ring-2 ring-surface-1",
    className,
  );
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={name} width={pixels[size]} height={pixels[size]} loading="lazy" decoding="async" className={cn(classes, "object-cover")} />;
  }
  return (
    <span className={classes} style={{ background: colorFor(name) }} role="img" aria-label={name} title={name}>
      {initials(name)}
    </span>
  );
}

/*
 * Overlap between stacked avatars, and the matching inline-end padding that
 * keeps each avatar's initials centred in the part that stays visible (the
 * next avatar covers the inline-end edge, in both reading directions).
 */
const stack = {
  xs: { overlap: "-space-x-1", visible: "pe-1" },
  sm: { overlap: "-space-x-2", visible: "pe-1.5" },
  md: { overlap: "-space-x-2.5", visible: "pe-2" },
  lg: { overlap: "-space-x-3", visible: "pe-2.5" },
  xl: { overlap: "-space-x-4", visible: "pe-3" },
  "2xl": { overlap: "-space-x-5", visible: "pe-4" },
} as const;

/** Overlapping avatars ("taught by", attendees) with a "+N" counter. */
export function AvatarGroup({
  users,
  max = 4,
  size = "sm",
  className,
}: {
  users: { name: string; avatarUrl?: string | null }[];
  max?: number;
  size?: keyof typeof sizes;
  className?: string;
}) {
  const shown = users.slice(0, max);
  const rest = users.length - shown.length;
  const { overlap, visible } = stack[size];
  return (
    <div className={cn("flex", overlap, className)}>
      {shown.map((u, i) => {
        const covered = i < shown.length - 1 || rest > 0;
        return <Avatar key={i} name={u.name} src={u.avatarUrl} size={size} ring className={covered && !u.avatarUrl ? visible : undefined} />;
      })}
      {rest > 0 && (
        <span className={cn("inline-flex shrink-0 items-center justify-center rounded-full bg-surface-3 font-medium text-ink-muted ring-2 ring-surface-1", sizes[size])}>
          +{rest}
        </span>
      )}
    </div>
  );
}
