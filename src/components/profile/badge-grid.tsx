"use client";

import { useState } from "react";
import type { ProfileBadgeGroup } from "@/lib/data/profile";
import { ButtonLink } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useFormatter, useT } from "@/i18n/client";
import type { Formatters } from "@/i18n/formatters";
import { LinkedinIcon, XIcon } from "./social-icons";

/** Issue date with a two-digit day ("Sep 08, 2026", "08 sept. 2026") in the active language. */
export function formatIssued(date: string, f: Formatters): string {
  return f.date(date, { day: "2-digit", month: "short", year: "numeric" }) || date;
}

/**
 * Achievements grid. Each badge shows a count bubble when earned more than
 * once; clicking opens a detail card with issue dates and, on your own
 * profile, LinkedIn / X share buttons.
 */
export function BadgeGrid({
  badges,
  isSelf,
  profileUrl,
  appName,
  compact = false,
}: {
  badges: ProfileBadgeGroup[];
  isSelf: boolean;
  profileUrl: string;
  appName: string;
  compact?: boolean;
}) {
  const [selected, setSelected] = useState<ProfileBadgeGroup | null>(null);
  const t = useT("account");
  const f = useFormatter();
  const shareText = selected ? t("profile.badges.shareText", { badge: selected.title, date: formatIssued(selected.issuedOn, f), brand: appName }) : "";

  return (
    <>
      <ul className={cn("grid gap-3", compact ? "grid-cols-3 sm:grid-cols-5" : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-5")}>
        {badges.map((b) => (
          <li key={b.id}>
            <button
              type="button"
              onClick={() => setSelected(b)}
              title={t("profile.badges.tooltip", { title: b.title, description: b.description })}
              className="group flex h-full w-full flex-col items-center rounded-xl border border-border bg-surface-1 p-3 text-center transition-colors hover:border-border-strong hover:bg-surface-2/60"
            >
              <span className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={b.imageUrl} alt="" className={cn("object-contain transition-transform group-hover:scale-105", compact ? "size-14" : "size-20")} loading="lazy" />
                {b.count > 1 && (
                  <span className="absolute -bottom-1 -end-2 rounded-full bg-surface-3 px-1.5 py-px text-[11px] font-semibold text-ink ring-2 ring-surface-1">
                    {t("profile.badges.times", { count: b.count })}
                  </span>
                )}
              </span>
              <span className="mt-2 line-clamp-2 text-sm font-medium text-ink">{b.title}</span>
              {!compact && <span className="mt-0.5 text-xs text-ink-faint">{formatIssued(b.issuedOn, f)}</span>}
            </button>
          </li>
        ))}
      </ul>

      <Dialog open={!!selected} onClose={() => setSelected(null)} size="sm" title={selected?.title}>
        {selected && (
          <div>
            <div className="-mx-5 -mt-4 mb-4 flex justify-center bg-surface-2 py-6">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={selected.imageUrl} alt={t("profile.badges.imageAlt", { title: selected.title })} className="size-36 object-contain" />
            </div>
            <p className="text-sm text-ink-muted">{selected.description}</p>
            <p className="mt-3 text-sm text-ink">
              {t.rich("profile.badges.issuedOn", { dates: f.list(selected.dates.map((d) => formatIssued(d, f))), muted: (text) => <span className="text-ink-muted">{text}</span> })}
            </p>
            {selected.count > 1 && <p className="mt-1 text-xs text-ink-muted">{t("profile.badges.earnedTimes", { count: selected.count })}</p>}
            {isSelf && (
              <div className="mt-4 border-t border-border pt-4">
                <p className="mb-2 text-sm font-medium text-ink">{t("profile.badges.shareOn")}</p>
                <div className="flex flex-wrap gap-2">
                  <ButtonLink
                    href={`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(profileUrl)}`}
                    variant="outline"
                    size="sm"
                    leftIcon={<LinkedinIcon className="size-4" />}
                  >
                    LinkedIn
                  </ButtonLink>
                  <ButtonLink
                    href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(profileUrl)}`}
                    variant="outline"
                    size="sm"
                    leftIcon={<XIcon className="size-4" />}
                  >
                    X
                  </ButtonLink>
                </div>
              </div>
            )}
          </div>
        )}
      </Dialog>
    </>
  );
}
