import Link from "next/link";
import type { CertifiedMember } from "@/lib/data/certificates";
import { Avatar } from "@/components/ui/avatar";
import { Icon } from "@/components/ui/icons";
import { RelativeTime } from "@/components/assessments/client-time";
import { formatShortDate } from "./time";

/** Directory card: avatar, name, headline (or join date), certificate count and latest issue date. */
export function CertifiedMemberCard({ member }: { member: CertifiedMember }) {
  const { user } = member;
  const body = (
    <>
      <div className="flex items-center gap-4">
        <Avatar name={user.name} src={user.avatarUrl} size="lg" />
        <div className="min-w-0">
          <p className="flex min-w-0 items-center gap-2">
            <span className="truncate font-semibold text-ink">{user.name}</span>
            {user.openTo && (
              <span
                className={
                  user.openTo === "work"
                    ? "inline-flex shrink-0 items-center gap-1 rounded-full bg-success/12 px-2 py-0.5 text-[11px] font-medium text-success"
                    : "inline-flex shrink-0 items-center gap-1 rounded-full bg-accent/12 px-2 py-0.5 text-[11px] font-medium text-accent"
                }
              >
                <Icon.CheckCircle className="size-3" />
                {user.openTo === "work" ? "Open to Work" : "Hiring"}
              </span>
            )}
          </p>
          <p className="line-clamp-2 text-sm text-ink-muted">
            {user.headline ? (
              user.headline
            ) : (
              <>
                Joined <RelativeTime iso={user.createdAt} />
              </>
            )}
          </p>
        </div>
      </div>
      {member.titles.length > 0 && (
        <ul className="mt-4 flex flex-wrap gap-1.5" aria-label="Certificates">
          {member.titles.slice(0, 3).map((t) => (
            <li key={t} className="max-w-full truncate rounded-md border border-border bg-surface-2 px-2 py-0.5 text-xs text-ink-muted">
              {t}
            </li>
          ))}
          {member.titles.length > 3 && <li className="rounded-md px-1 py-0.5 text-xs text-ink-faint">+{member.titles.length - 3} more</li>}
        </ul>
      )}
      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-4">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-accent/12 px-2.5 py-1 text-sm font-medium text-accent">
          <Icon.GraduationCap className="size-4" />
          {member.certificateCount} {member.certificateCount === 1 ? "certificate" : "certificates"}
        </span>
        <span className="inline-flex items-center gap-1.5 text-xs text-ink-muted">
          <Icon.Calendar className="size-3.5" />
          {formatShortDate(member.latestIssueDate)}
        </span>
      </div>
    </>
  );
  const classes = "flex h-full flex-col rounded-card border border-border bg-surface-1 p-5 shadow-card transition-colors";
  return user.username ? (
    <Link href={`/user/${user.username}`} className={`${classes} hover:border-border-strong hover:bg-surface-2/40`}>
      {body}
    </Link>
  ) : (
    <div className={classes}>{body}</div>
  );
}
