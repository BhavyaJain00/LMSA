import Link from "next/link";
import type { ReactNode } from "react";
import type { BatchSummary, PublicUser } from "@/lib/types";
import { cn, gradientFor } from "@/lib/utils";
import { cardGradients } from "@/lib/config";
import { Badge } from "@/components/ui/badge";
import { AvatarGroup } from "@/components/ui/avatar";
import { Icon } from "@/components/ui/icons";
import { getFormatter, getT } from "@/i18n/server";
import type { BatchStatus } from "./types";

/** Deterministic gradient for batches without a cover image. */
export function batchGradient(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return gradientFor(cardGradients[h % cardGradients.length]);
}

export function BatchCover({
  batch,
  className,
  children,
  priority = false,
}: {
  batch: Pick<BatchSummary, "id" | "title" | "imageUrl">;
  className?: string;
  children?: ReactNode;
  /** The cover is the page's main image (largest contentful paint): load it eagerly and first. */
  priority?: boolean;
}) {
  return (
    <div className={cn("relative overflow-hidden", className)}>
      {batch.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={batch.imageUrl}
          alt=""
          className="absolute inset-0 size-full object-cover"
          loading={priority ? "eager" : "lazy"}
          fetchPriority={priority ? "high" : undefined}
          decoding="async"
        />
      ) : (
        <div className={cn("absolute inset-0 bg-gradient-to-br", batchGradient(batch.id))} aria-hidden="true">
          <Icon.Users className="absolute -bottom-4 -end-4 size-28 text-white/15" />
          <span className="absolute start-4 top-1/2 max-w-[80%] -translate-y-1/2 text-xl font-semibold leading-tight text-white/95 line-clamp-2">
            {batch.title}
          </span>
        </div>
      )}
      {children}
    </div>
  );
}

const statusMeta = {
  upcoming: { label: "batches.status.upcoming", tone: "info" },
  active: { label: "batches.status.active", tone: "success" },
  completed: { label: "batches.status.completed", tone: "neutral" },
} as const satisfies Record<BatchStatus, { label: string; tone: "info" | "success" | "neutral" }>;

export async function BatchStatusBadge({ status, className }: { status: BatchStatus; className?: string }) {
  const t = await getT("public");
  const meta = statusMeta[status];
  return (
    <Badge tone={meta.tone} dot className={className}>
      {t(meta.label)}
    </Badge>
  );
}

/** '{n} seats left' / '1 seat left' / 'Full' — nothing when seats are unlimited. */
export async function SeatBadge({ seatsLeft, className }: { seatsLeft: number | null; className?: string }) {
  if (seatsLeft === null) return null;
  const t = await getT("public");
  if (seatsLeft <= 0)
    return (
      <Badge tone="danger" className={className}>
        {t("batches.seats.full")}
      </Badge>
    );
  return (
    <Badge tone={seatsLeft <= 3 ? "warning" : "success"} className={className}>
      {t("batches.seats.left", { count: seatsLeft })}
    </Badge>
  );
}

/** The batch price in the active language, or null when the batch is free. */
export async function batchPriceLabel(batch: Pick<BatchSummary, "paidBatch" | "amount" | "currency">): Promise<string | null> {
  if (!(batch.paidBatch && batch.amount > 0)) return null;
  const f = await getFormatter();
  return f.price(batch.amount, batch.currency);
}

/** 'Full Name' | 'First and First' | 'First and {n} others' */
export async function instructorNamesText(users: PublicUser[]): Promise<string> {
  if (!users.length) return "";
  if (users.length === 1) return users[0]!.name;
  const t = await getT("public");
  const first = (u: PublicUser) => u.name.split(" ")[0] ?? u.name;
  if (users.length === 2) return t("shared.byline.two", { first: first(users[0]!), second: first(users[1]!) });
  return t("shared.byline.more", { first: first(users[0]!), count: users.length - 1 });
}

export async function InstructorNames({ users, linked = false, className, size = "xs" }: { users: PublicUser[]; linked?: boolean; className?: string; size?: "xs" | "sm" }) {
  if (!users.length) return null;
  const [t, names] = await Promise.all([getT("public"), instructorNamesText(users)]);
  const profileLink = (u: PublicUser) => (
    <Link href={`/user/${u.username}`} className="font-medium text-ink hover:text-accent hover:underline">
      {u.name}
    </Link>
  );
  return (
    <div className={cn("flex min-w-0 items-center gap-2", className)}>
      <AvatarGroup users={users} max={3} size={size} />
      {linked ? (
        <span className="min-w-0 truncate text-sm text-ink-muted">
          {users.length === 1
            ? profileLink(users[0]!)
            : users.length === 2
              ? t.rich("shared.byline.two", { first: profileLink(users[0]!), second: profileLink(users[1]!) })
              : t.rich("shared.byline.more", { first: profileLink(users[0]!), count: users.length - 1 })}
        </span>
      ) : (
        <span className="min-w-0 truncate text-sm text-ink-muted">{names}</span>
      )}
    </div>
  );
}

export function MetaRow({ icon, children, className }: { icon: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-start gap-2 text-sm text-ink-muted", className)}>
      <span className="mt-0.5 shrink-0 text-ink-faint [&>svg]:size-4">{icon}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
