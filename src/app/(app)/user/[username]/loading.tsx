import { ProfileContentSkeleton } from "@/components/profile/profile-skeletons";
import { getT } from "@/i18n/server";

/**
 * Shown while a profile tab loads. The profile layout already renders the real
 * header and tab bar (and returns a proper 404 for unknown usernames), so this
 * fallback only covers the tab body below them.
 */
export default async function ProfileTabLoading() {
  const t = await getT("account");
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">{t("profile.loading")}</span>
      <ProfileContentSkeleton />
    </div>
  );
}
