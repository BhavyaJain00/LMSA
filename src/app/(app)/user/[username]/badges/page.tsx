import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getSettings } from "@/lib/db/store";
import { getProfileBadges, getProfileView, getRequestOrigin } from "@/lib/data/profile";
import { Icon } from "@/components/ui/icons";
import { EmptyState } from "@/components/ui/skeleton";
import { BadgeGrid } from "@/components/profile/badge-grid";
import { getT } from "@/i18n/server";

export async function generateMetadata() {
  return { title: (await getT("account"))("profile.tabs.badges") };
}

export default async function ProfileBadgesPage(props: PageProps<"/user/[username]/badges">) {
  const { username } = await props.params;
  await requireUser(`/user/${username}/badges`);
  const [view, settings, t] = await Promise.all([getProfileView(decodeURIComponent(username)), getSettings(), getT("account")]);
  if (!view || !settings.features.badges) notFound();
  const [badges, origin] = await Promise.all([getProfileBadges(view.user.id), getRequestOrigin()]);
  const total = badges.reduce((acc, b) => acc + b.count, 0);

  return (
    <section aria-labelledby="badges-title">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="badges-title" className="text-lg font-semibold tracking-tight text-ink">
          {t("profile.about.achievements")}
        </h2>
        {total > 0 && (
          <p className="text-sm text-ink-muted">
            {t("profile.badges.earned", { count: total })}
          </p>
        )}
      </div>
      {badges.length === 0 ? (
        <EmptyState
          compact
          icon={<Icon.Award />}
          title={view.isSelf ? t("profile.badges.emptySelf") : t("profile.badges.emptyOther", { name: view.user.name })}
          description={
            view.isSelf
              ? t("profile.badges.emptyHint")
              : undefined
          }
        />
      ) : (
        <BadgeGrid badges={badges} isSelf={view.isSelf} profileUrl={`${origin}/user/${view.user.username}`} appName={settings.brand.name} />
      )}
    </section>
  );
}
