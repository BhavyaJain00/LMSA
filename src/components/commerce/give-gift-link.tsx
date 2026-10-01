import Link from "next/link";
import type { GiftItemType } from "@/lib/commerce/gifts";
import { Icon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

/** "Give as a gift" link to the gift checkout of a course, bundle or membership plan. */
export function GiveGiftLink({ type, id, className, label = "Give as a gift" }: { type: GiftItemType; id: string; className?: string; label?: string }) {
  return (
    <Link
      href={`/gift?type=${type}&id=${encodeURIComponent(id)}`}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-lg text-sm font-medium text-accent outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent/60",
        className,
      )}
    >
      <Icon.Gift className="size-4" aria-hidden="true" />
      {label}
    </Link>
  );
}
