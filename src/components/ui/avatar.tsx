import { cn, initials } from "@/lib/utils";

/** Rendered size in CSS pixels of each avatar size (for the img width/height attributes). */
const pixels = { xs: 24, sm: 32, md: 40, lg: 56, xl: 80, "2xl": 112 } as const;

const sizes = {
  xs: "size-6 text-[10px]",
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
    <span className={classes} style={{ background: colorFor(name) }} aria-label={name} title={name}>
      {initials(name)}
    </span>
  );
}

export function AvatarGroup({
  users,
  max = 4,
  size = "sm",
}: {
  users: { name: string; avatarUrl?: string | null }[];
  max?: number;
  size?: keyof typeof sizes;
}) {
  const shown = users.slice(0, max);
  const rest = users.length - shown.length;
  return (
    <div className="flex -space-x-2">
      {shown.map((u, i) => (
        <Avatar key={i} name={u.name} src={u.avatarUrl} size={size} ring />
      ))}
      {rest > 0 && (
        <span className={cn("inline-flex items-center justify-center rounded-full bg-surface-3 font-medium text-ink-muted ring-2 ring-surface-1", sizes[size])}>
          +{rest}
        </span>
      )}
    </div>
  );
}
