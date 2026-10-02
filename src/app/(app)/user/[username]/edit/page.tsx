import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { findById } from "@/lib/db/store";
import { getProfileView } from "@/lib/data/profile";
import { ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { EmptyState } from "@/components/ui/skeleton";
import { EditProfileForm, type EditProfileValues } from "@/components/profile/edit-profile-form";
import { getT } from "@/i18n/server";

export async function generateMetadata() {
  return { title: (await getT("account"))("profile.edit.metaTitle") };
}

export default async function EditProfilePage(props: PageProps<"/user/[username]/edit">) {
  const { username } = await props.params;
  await requireUser(`/user/${username}/edit`);
  const view = await getProfileView(decodeURIComponent(username));
  if (!view) notFound();
  const base = `/user/${view.user.username}`;

  if (!view.canEdit) {
    const t = await getT("account");
    return (
      <EmptyState
        icon={<Icon.Lock />}
        title={t("profile.edit.notAllowed")}
        description={t("profile.edit.notAllowedHint")}
        action={
          <ButtonLink href={base} variant="outline" size="sm">
            {t("profile.edit.backToProfile")}
          </ButtonLink>
        }
      />
    );
  }

  // Load the full record: the public view may hide fields the form needs.
  const target = await findById("users", view.user.id);
  if (!target) notFound();

  const initial: EditProfileValues = {
    name: target.name,
    username: target.username,
    headline: target.headline ?? "",
    location: target.location ?? "",
    openTo: target.openTo ?? "",
    bio: target.bio ?? "",
    avatarUrl: target.avatarUrl ?? "",
    coverImageUrl: target.coverImageUrl ?? "",
    socials: {
      website: target.socials?.website ?? "",
      linkedin: target.socials?.linkedin ?? "",
      github: target.socials?.github ?? "",
      x: target.socials?.x ?? "",
      youtube: target.socials?.youtube ?? "",
    },
    skills: target.skills ?? [],
    education: target.education ?? [],
    workExperience: target.workExperience ?? [],
  };

  return <EditProfileForm userId={target.id} initial={initial} isSelf={view.isSelf} backHref={base} />;
}
