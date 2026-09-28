import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getSettings } from "@/lib/db/store";
import { getProfileBadges, getProfileView, getRequestOrigin } from "@/lib/data/profile";
import { Icon } from "@/components/ui/icons";
import { EmptyState } from "@/components/ui/skeleton";
import { BadgeGrid } from "@/components/profile/badge-grid";

export const metadata = { title: "Badges" };

export default async function ProfileBadgesPage(props: PageProps<"/user/[username]/badges">) {
  const { username } = await props.params;
  await requireUser(`/user/${username}/badges`);
  const [view, settings] = await Promise.all([getProfileView(decodeURIComponent(username)), getSettings()]);
  if (!view || !settings.features.badges) notFound();
  const [badges, origin] = await Promise.all([getProfileBadges(view.user.id), getRequestOrigin()]);
  const total = badges.reduce((acc, b) => acc + b.count, 0);

  return (
    <section aria-labelledby="badges-title">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="badges-title" className="text-lg font-semibold tracking-tight text-ink">
          Achievements
        </h2>
        {total > 0 && (
          <p className="text-sm text-ink-muted">
            {total} {total === 1 ? "badge" : "badges"} earned
          </p>
        )}
      </div>
      {badges.length === 0 ? (
        <EmptyState
          compact
          icon={<Icon.Award />}
          title={view.isSelf ? "No badges yet" : `${view.user.name} hasn't earned any badges yet`}
          description={
            view.isSelf
              ? "Badges are awarded for milestones like enrolling in your first course, finishing a course, passing quizzes and keeping a streak."
              : undefined
          }
        />
      ) : (
        <BadgeGrid badges={badges} isSelf={view.isSelf} profileUrl={`${origin}/user/${view.user.username}`} appName={settings.brand.name} />
      )}
    </section>
  );
}
