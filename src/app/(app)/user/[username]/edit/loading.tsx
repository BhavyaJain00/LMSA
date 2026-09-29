import { ProfileEditSkeleton } from "@/components/profile/profile-skeletons";

export default function EditProfileLoading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading the profile editor…</span>
      <ProfileEditSkeleton />
    </div>
  );
}
