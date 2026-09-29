import Link from "next/link";
import type { CommunityTopic } from "@/lib/data/community";
import { Avatar, AvatarGroup } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icons";
import { cn, relativeTime } from "@/lib/utils";

function Where({ topic }: { topic: CommunityTopic }) {
  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-1 text-xs text-ink-muted">
      {topic.kind === "batch" ? <Icon.Users className="size-3.5 shrink-0 text-ink-faint" /> : <Icon.BookOpen className="size-3.5 shrink-0 text-ink-faint" />}
      <span className="truncate">
        {topic.where.title}
        {topic.lessonTitle && <span className="text-ink-faint"> › {topic.lessonTitle}</span>}
      </span>
    </span>
  );
}

function TopicRow({ topic }: { topic: CommunityTopic }) {
  const replies = topic.replyCount;
  return (
    <li className="relative">
      <article className="flex gap-3 px-4 py-4 transition-colors hover:bg-surface-2/60 sm:gap-4">
        <Avatar name={topic.author?.name ?? "Former member"} src={topic.author?.avatarUrl} size="md" className="mt-0.5 hidden sm:inline-flex" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            {topic.instructorAnswered ? (
              <Badge tone="success" size="xs">
                <Icon.CheckCircle className="size-3" />
                Instructor answered
              </Badge>
            ) : !topic.answered ? (
              <Badge tone="warning" size="xs">
                Unanswered
              </Badge>
            ) : null}
            {topic.isAuthor && (
              <Badge tone="accent" size="xs">
                You asked
              </Badge>
            )}
            {!topic.isAuthor && topic.participated && (
              <Badge tone="neutral" size="xs">
                You replied
              </Badge>
            )}
          </div>
          <h3 className="mt-1 text-base font-semibold leading-snug text-ink">
            <Link href={topic.href} className="after:absolute after:inset-0 hover:text-accent focus-visible:outline-none focus-visible:after:rounded-lg focus-visible:after:ring-2 focus-visible:after:ring-accent/40">
              {topic.title}
            </Link>
          </h3>
          {topic.excerpt && <p className="mt-1 line-clamp-2 text-sm text-ink-muted">{topic.excerpt}</p>}
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
            <Where topic={topic} />
            <span className="text-xs text-ink-faint">
              Asked by <span className="text-ink-muted">{topic.author?.name ?? "a former member"}</span>
              {topic.authorIsInstructor && " (instructor)"} · {relativeTime(topic.createdAt)}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2 text-right">
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold tabular-nums",
              replies === 0 ? "bg-surface-2 text-ink-muted" : topic.instructorAnswered ? "bg-success/10 text-success" : "bg-accent/10 text-accent",
            )}
            aria-label={`${replies} ${replies === 1 ? "reply" : "replies"}`}
          >
            <Icon.MessageCircle className="size-3.5" aria-hidden="true" />
            {replies}
          </span>
          {topic.participants.length > 1 && (
            <span className="hidden sm:block">
              <AvatarGroup users={topic.participants.map((p) => ({ name: p.name, avatarUrl: p.avatarUrl }))} max={3} size="xs" />
            </span>
          )}
          <span className="text-[11px] leading-tight text-ink-faint">
            {topic.lastReplyBy ? (
              <>
                <span className="hidden sm:inline">{topic.lastReplyBy.name.split(" ")[0]} replied </span>
                <time dateTime={topic.lastActivityAt}>{relativeTime(topic.lastActivityAt)}</time>
              </>
            ) : (
              <time dateTime={topic.lastActivityAt}>{relativeTime(topic.lastActivityAt)}</time>
            )}
          </span>
        </div>
      </article>
    </li>
  );
}

/** Topics as a list; each row links to the thread in place. */
export function TopicList({ topics }: { topics: CommunityTopic[] }) {
  return (
    <Card className="overflow-hidden">
      <ul className="divide-y divide-border">
        {topics.map((t) => (
          <TopicRow key={t.id} topic={t} />
        ))}
      </ul>
    </Card>
  );
}
