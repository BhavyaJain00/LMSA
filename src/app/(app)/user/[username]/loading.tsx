import { ProfileContentSkeleton } from "@/components/profile/profile-skeletons";

/**
 * Shown while a profile tab loads. The profile layout already renders the real
 * header and tab bar (and returns a proper 404 for unknown usernames), so this
 * fallback only covers the tab body below them.
 */
export default function ProfileTabLoading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading profile…</span>
      <ProfileContentSkeleton />
    </div>
  );
}
