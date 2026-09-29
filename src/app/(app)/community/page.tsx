import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/session";
import { getSettings } from "@/lib/db/store";
import { getCommunityHub, parseCommunityTab, type CommunityTab } from "@/lib/data/community";
import { ButtonLink } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/card";
import { Icon } from "@/components/ui/icons";
import { EmptyState } from "@/components/ui/skeleton";
import { AskQuestionCard, CommunityStatsCard, TopContributors } from "@/components/community/community-sidebar";
import { CommunityFilters } from "@/components/community/community-filters";
import { HubTabs } from "@/components/community/hub-tabs";
import { TopicList } from "@/components/community/topic-list";
import { PageLinks } from "@/components/gamification/page-links";

export const metadata: Metadata = {
  title: "Community",
  description: "Questions and discussions from your courses and batches in one place.",
};

const emptyByTab: Record<CommunityTab, { title: string; description: string }> = {
  latest: {
    title: "No discussions yet",
    description: "Questions asked in your lessons and batches will show up here as soon as someone starts one.",
  },
  unanswered: {
    title: "Every question has a reply",
    description: "Nothing is waiting for an answer right now. Check back later to help someone out.",
  },
  mine: {
    title: "You haven't joined a discussion yet",
    description: "Questions you ask and threads you reply to are collected here.",
  },
};

export default async function CommunityPage(props: PageProps<"/community">) {
  const [sp, user, settings] = await Promise.all([props.searchParams, requireUser("/community"), getSettings()]);

  if (!settings.features.discussions) {
    return (
      <div className="animate-fade-in">
        <PageHeader title="Community" />
        <EmptyState
          icon={<Icon.MessageSquare />}
          title="Discussions are turned off"
          description="Course and batch discussions are not in use on this site right now."
          action={
            <ButtonLink href="/dashboard" variant="outline">
              Go to dashboard
            </ButtonLink>
          }
        />
      </div>
    );
  }

  const tab = parseCommunityTab(sp.tab);
  const scopeParam = typeof sp.scope === "string" && sp.scope ? sp.scope : null;
  const queryParam = typeof sp.q === "string" ? sp.q : "";
  const pageParam = Number(typeof sp.page === "string" ? sp.page : "1");
  const hub = await getCommunityHub(user, { tab, scope: scopeParam, query: queryParam, page: Number.isFinite(pageParam) ? pageParam : 1 });

  const buildHref = (next: { tab?: CommunityTab; page?: number; scope?: string | null; q?: string }) => {
    const params = new URLSearchParams();
    const t = next.tab ?? hub.tab;
    const s = next.scope === undefined ? hub.scope : next.scope;
    const q = next.q === undefined ? hub.query : next.q;
    if (t !== "latest") params.set("tab", t);
    if (s) params.set("scope", s);
    if (q) params.set("q", q);
    if (next.page && next.page > 1) params.set("page", String(next.page));
    const qs = params.toString();
    return qs ? `/community?${qs}` : "/community";
  };

  const filtered = !!hub.scope || !!hub.query;
  const noSpaces = hub.spaces.courses + hub.spaces.batches === 0;

  return (
    <div className="animate-fade-in">
      <PageHeader title="Community" description="Questions and discussions from your courses and batches, all in one place. Jump into any thread to reply." />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-8">
        <div className="min-w-0 space-y-4">
          {noSpaces ? (
            <EmptyState
              icon={<Icon.Users />}
              title="Join a course or batch to take part"
              description="Discussions happen inside courses and batches. Once you enroll, their questions and replies appear here."
              action={
                <div className="flex flex-wrap justify-center gap-2">
                  {settings.features.courses && (
                    <ButtonLink href="/courses" size="sm">
                      Browse courses
                    </ButtonLink>
                  )}
                  {settings.features.batches && (
                    <ButtonLink href="/batches" size="sm" variant="outline">
                      Browse batches
                    </ButtonLink>
                  )}
                </div>
              }
            />
          ) : (
            <>
              <CommunityFilters key={`${hub.scope ?? ""}|${hub.query}`} tab={hub.tab} scope={hub.scope} query={hub.query} scopes={hub.scopes} />
              <HubTabs active={hub.tab} counts={hub.counts} hrefFor={(t) => buildHref({ tab: t, page: 1 })} />

              {filtered && (
                <p className="flex flex-wrap items-center gap-2 text-sm text-ink-muted" aria-live="polite">
                  <span>
                    {hub.total} {hub.total === 1 ? "discussion" : "discussions"}
                    {hub.query && (
                      <>
                        {" "}
                        matching <span className="font-medium text-ink">“{hub.query}”</span>
                      </>
                    )}
                    {hub.scope && (
                      <>
                        {" "}
                        in{" "}
                        <span className="font-medium text-ink">
                          {[...hub.scopes.courses, ...hub.scopes.batches].find((s) => s.value === hub.scope)?.label ?? "this space"}
                        </span>
                      </>
                    )}
                  </span>
                  <ButtonLink href={buildHref({ scope: null, q: "", page: 1 })} variant="ghost" size="xs" leftIcon={<Icon.X className="size-3.5" />}>
                    Clear filters
                  </ButtonLink>
                </p>
              )}

              {hub.topics.length === 0 ? (
                filtered ? (
                  <EmptyState
                    compact
                    icon={<Icon.Search />}
                    title="No discussions match"
                    description="Try a different search or show every course and batch."
                    action={
                      <ButtonLink href={buildHref({ scope: null, q: "", page: 1 })} size="sm" variant="outline">
                        Clear filters
                      </ButtonLink>
                    }
                  />
                ) : (
                  <EmptyState
                    compact
                    icon={hub.tab === "unanswered" ? <Icon.CheckCircle /> : <Icon.MessageSquare />}
                    title={emptyByTab[hub.tab].title}
                    description={emptyByTab[hub.tab].description}
                    action={
                      hub.tab !== "latest" && hub.totalVisible > 0 ? (
                        <ButtonLink href={buildHref({ tab: "latest", page: 1 })} size="sm" variant="outline">
                          See all discussions
                        </ButtonLink>
                      ) : undefined
                    }
                  />
                )
              ) : (
                <>
                  <TopicList topics={hub.topics} />
                  <PageLinks page={hub.page} pageCount={hub.pageCount} hrefFor={(p) => buildHref({ page: p })} label="Discussion pages" />
                </>
              )}
            </>
          )}
        </div>

        <aside className="min-w-0 space-y-6" aria-label="Community highlights">
          <TopContributors contributors={hub.contributors} monthLabel={hub.monthLabel} pointsEnabled={hub.pointsEnabled} viewerId={user.id} />
          {!noSpaces && <CommunityStatsCard stats={hub.stats} />}
          <AskQuestionCard hasCourses={hub.spaces.courses > 0 && settings.features.courses} hasBatches={hub.spaces.batches > 0 && settings.features.batches} />
        </aside>
      </div>
    </div>
  );
}
