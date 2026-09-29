import Link from "next/link";
import type { CommunityContributor, CommunityViewerStats } from "@/lib/data/community";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";
import { MEDAL_CHIP } from "@/components/gamification/medals";

const placeTone = MEDAL_CHIP;

/** "Top contributors this month": most answers to other members' questions. */
export function TopContributors({ contributors, monthLabel, pointsEnabled, viewerId }: { contributors: CommunityContributor[]; monthLabel: string; pointsEnabled: boolean; viewerId: string }) {
  return (
    <Card className="p-4">
      <div className="mb-3">
        <h2 className="text-sm font-semibold text-ink">Top contributors this month</h2>
        <p className="text-xs text-ink-muted">Most helpful replies in your courses and batches in {monthLabel}.</p>
      </div>
      {contributors.length === 0 ? (
        <div className="flex items-center gap-3 rounded-lg bg-surface-2 p-3">
          <Icon.Handshake className="size-6 shrink-0 text-ink-faint" />
          <p className="text-xs text-ink-muted">No replies yet this month. Answer a question to be the first on this list.</p>
        </div>
      ) : (
        <ol className="space-y-2.5">
          {contributors.map((c, i) => (
            <li key={c.member.id} className="flex items-center gap-2.5">
              <span className={cn("flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold", placeTone[i] ?? "bg-surface-2 text-ink-muted")} aria-label={`Place ${i + 1}`}>
                {i + 1}
              </span>
              <Avatar name={c.member.name} src={c.member.avatarUrl} size="sm" />
              <span className="min-w-0 flex-1">
                <Link href={`/user/${c.member.username}`} className="flex min-w-0 items-center gap-1.5 text-sm font-medium text-ink hover:text-accent">
                  <span className="truncate">{c.member.name}</span>
                  {c.member.id === viewerId && (
                    <Badge tone="accent" size="xs">
                      You
                    </Badge>
                  )}
                  {c.isInstructor && (
                    <Badge tone="info" size="xs">
                      Instructor
                    </Badge>
                  )}
                </Link>
                <span className="block text-xs text-ink-muted">
                  {c.answers} {c.answers === 1 ? "answer" : "answers"}
                  {c.replies > c.answers && ` · ${c.replies} ${c.replies === 1 ? "reply" : "replies"} in all`}
                </span>
              </span>
              {pointsEnabled && c.points > 0 && <span className="shrink-0 text-xs font-semibold tabular-nums text-success">+{c.points} pts</span>}
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

/** The viewer's own participation. */
export function CommunityStatsCard({ stats }: { stats: CommunityViewerStats }) {
  const items = [
    { label: "Questions asked", value: stats.asked, icon: <Icon.Question className="size-4" /> },
    { label: "Replies posted", value: stats.replies, icon: <Icon.MessageSquare className="size-4" /> },
    { label: "Waiting for a reply", value: stats.waiting, icon: <Icon.Clock className="size-4" /> },
    { label: "Answered by instructors", value: stats.instructorAnswered, icon: <Icon.CheckCircle className="size-4" /> },
  ];
  return (
    <Card className="p-4">
      <h2 className="mb-3 text-sm font-semibold text-ink">Your activity</h2>
      <dl className="grid grid-cols-2 gap-3">
        {items.map((s) => (
          <div key={s.label} className="rounded-lg bg-surface-2 p-3">
            <dt className="flex items-center gap-1.5 text-xs text-ink-muted">
              <span className="text-ink-faint" aria-hidden="true">
                {s.icon}
              </span>
              {s.label}
            </dt>
            <dd className="mt-1 text-xl font-semibold tabular-nums text-ink">{s.value}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

/** Where new questions are asked (topics are always created in place). */
export function AskQuestionCard({ hasCourses, hasBatches }: { hasCourses: boolean; hasBatches: boolean }) {
  return (
    <Card className="p-4">
      <h2 className="text-sm font-semibold text-ink">Have a question?</h2>
      <p className="mt-1 text-xs text-ink-muted">
        Ask it where it belongs so the right people see it: open a lesson and use its <span className="font-medium text-ink">Discussion</span> tab, or post in your
        batch&apos;s <span className="font-medium text-ink">Discussions</span> tab.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {hasCourses && (
          <Link href="/courses?tab=enrolled" className="inline-flex items-center gap-1.5 rounded-lg bg-surface-2 px-2.5 py-1.5 text-xs font-medium text-ink hover:bg-surface-3">
            <Icon.BookOpen className="size-3.5" />
            My courses
          </Link>
        )}
        {hasBatches && (
          <Link href="/batches?tab=enrolled" className="inline-flex items-center gap-1.5 rounded-lg bg-surface-2 px-2.5 py-1.5 text-xs font-medium text-ink hover:bg-surface-3">
            <Icon.Users className="size-3.5" />
            My batches
          </Link>
        )}
      </div>
    </Card>
  );
}
