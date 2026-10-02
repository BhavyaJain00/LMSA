import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getSettings } from "@/lib/db/store";
import { getProfileView } from "@/lib/data/profile";
import { Icon } from "@/components/ui/icons";
import { Tabs, type TabItem } from "@/components/ui/tabs";
import { ProfileHeader } from "@/components/profile/profile-header";
import { MessageUserButton } from "@/components/messages/message-button";
import { I18nProvider } from "@/i18n/provider";
import { getT } from "@/i18n/server";

export async function generateMetadata({ params }: { params: Promise<{ username: string }> }): Promise<Metadata> {
  const { username } = await params;
  const view = await getProfileView(decodeURIComponent(username));
  // Tab pages (certificates, badges, roles, slots, schedule) keep the root noindex default;
  // the About page opts into indexing for instructor profiles.
  if (!view) return { title: (await getT("account"))("profile.notFound") };
  return { title: view.user.name };
}

/** Profile shell: header + tab bar (About | Certificates | Badges | Roles | Slots | Schedule). */
export default async function ProfileLayout(props: LayoutProps<"/user/[username]">) {
  const { username } = await props.params;
  const [view, settings, t] = await Promise.all([getProfileView(decodeURIComponent(username)), getSettings(), getT("account")]);
  if (!view) notFound();

  const base = `/user/${view.user.username}`;
  const tabs: TabItem[] = [{ label: t("profile.tabs.about"), href: base, icon: <Icon.User className="size-4" /> }];
  if (view.viewer) {
    if (settings.features.certifications) {
      tabs.push({ label: t("profile.tabs.certificates"), href: `${base}/certificates`, icon: <Icon.Certificate className="size-4" />, count: view.stats.certificates });
    }
    if (settings.features.badges) {
      tabs.push({ label: t("profile.tabs.badges"), href: `${base}/badges`, icon: <Icon.Award className="size-4" />, count: view.stats.badges });
    }
    if (view.canManageRoles) tabs.push({ label: t("profile.tabs.roles"), href: `${base}/roles`, icon: <Icon.Shield className="size-4" /> });
    if (view.showEvaluatorTabs) {
      tabs.push({ label: t("profile.tabs.slots"), href: `${base}/slots`, icon: <Icon.Clock className="size-4" /> });
      tabs.push({ label: t("profile.tabs.schedule"), href: `${base}/schedule`, icon: <Icon.Calendar className="size-4" /> });
    }
  }

  return (
    <I18nProvider namespaces={["account"]} pick={{ account: ["profile.", "errors.", "theme."] }}>
      <div className="animate-fade-in">
        <ProfileHeader view={view} />
        {/* Round 3 comms: direct message button, shown only when the viewer may message this member. */}
        <MessageUserButton userId={view.user.id} label={t("profile.sendMessage")} className="mt-4" />
        {tabs.length > 1 ? (
          <Tabs items={tabs} className="mt-8" />
        ) : (
          !view.viewer && (
            <p className="mt-8 flex flex-wrap items-center gap-1.5 rounded-lg border border-border bg-surface-2/60 px-3 py-2 text-sm text-ink-muted">
              <Icon.Lock className="size-4 text-ink-faint" />
              {t.rich("profile.guestPrompt", {
                name: view.user.name.split(" ")[0],
                link: (text) => (
                  <Link href={`/login?next=${encodeURIComponent(base)}`} className="font-medium text-accent hover:underline">
                    {text}
                  </Link>
                ),
              })}
            </p>
          )
        )}
        <div className="mt-6">{props.children}</div>
      </div>
    </I18nProvider>
  );
}
