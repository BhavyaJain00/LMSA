import Link from "next/link";
import type { ReactNode } from "react";
import type { BatchSummary, PublicUser } from "@/lib/types";
import { cn, formatPrice, gradientFor } from "@/lib/utils";
import { cardGradients } from "@/lib/config";
import { Badge } from "@/components/ui/badge";
import { AvatarGroup } from "@/components/ui/avatar";
import { Icon } from "@/components/ui/icons";
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
          <Icon.Users className="absolute -bottom-4 -right-4 size-28 text-white/15" />
          <span className="absolute left-4 top-1/2 max-w-[80%] -translate-y-1/2 text-xl font-semibold leading-tight text-white/95 line-clamp-2">
            {batch.title}
          </span>
        </div>
      )}
      {children}
    </div>
  );
}

const statusMeta: Record<BatchStatus, { label: string; tone: "info" | "success" | "neutral" }> = {
  upcoming: { label: "Upcoming", tone: "info" },
  active: { label: "Live now", tone: "success" },
  completed: { label: "Completed", tone: "neutral" },
};

export function BatchStatusBadge({ status, className }: { status: BatchStatus; className?: string }) {
  const meta = statusMeta[status];
  return (
    <Badge tone={meta.tone} dot className={className}>
      {meta.label}
    </Badge>
  );
}

/** '{n} Seats Left' / '1 Seat Left' / 'Full' — nothing when seats are unlimited. */
export function SeatBadge({ seatsLeft, className }: { seatsLeft: number | null; className?: string }) {
  if (seatsLeft === null) return null;
  if (seatsLeft <= 0)
    return (
      <Badge tone="danger" className={className}>
        Full
      </Badge>
    );
  return (
    <Badge tone={seatsLeft <= 3 ? "warning" : "success"} className={className}>
      {seatsLeft === 1 ? "1 Seat Left" : `${seatsLeft} Seats Left`}
    </Badge>
  );
}

export function batchPriceLabel(batch: Pick<BatchSummary, "paidBatch" | "amount" | "currency">): string {
  return batch.paidBatch && batch.amount > 0 ? formatPrice(batch.amount, batch.currency) : "Free";
}

/** 'Full Name' | 'First and First' | 'First and {n} others' */
export function instructorNamesText(users: PublicUser[]): string {
  if (!users.length) return "";
  if (users.length === 1) return users[0]!.name;
  const first = (u: PublicUser) => u.name.split(" ")[0] ?? u.name;
  if (users.length === 2) return `${first(users[0]!)} and ${first(users[1]!)}`;
  return `${first(users[0]!)} and ${users.length - 1} others`;
}

export function InstructorNames({ users, linked = false, className, size = "xs" }: { users: PublicUser[]; linked?: boolean; className?: string; size?: "xs" | "sm" }) {
  if (!users.length) return null;
  return (
    <div className={cn("flex min-w-0 items-center gap-2", className)}>
      <AvatarGroup users={users} max={3} size={size} />
      {linked ? (
        <span className="min-w-0 truncate text-sm text-ink-muted">
          {users.length <= 2
            ? users.map((u, i) => (
                <span key={u.id}>
                  {i > 0 && " and "}
                  <Link href={`/user/${u.username}`} className="font-medium text-ink hover:text-accent hover:underline">
                    {u.name}
                  </Link>
                </span>
              ))
            : (
                <>
                  <Link href={`/user/${users[0]!.username}`} className="font-medium text-ink hover:text-accent hover:underline">
                    {users[0]!.name}
                  </Link>{" "}
                  and {users.length - 1} others
                </>
              )}
        </span>
      ) : (
        <span className="min-w-0 truncate text-sm text-ink-muted">{instructorNamesText(users)}</span>
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
