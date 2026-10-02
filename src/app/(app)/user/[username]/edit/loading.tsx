import { ProfileEditSkeleton } from "@/components/profile/profile-skeletons";
import { getT } from "@/i18n/server";

export default async function EditProfileLoading() {
  const t = await getT("account");
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">{t("profile.edit.loading")}</span>
      <ProfileEditSkeleton />
    </div>
  );
}
