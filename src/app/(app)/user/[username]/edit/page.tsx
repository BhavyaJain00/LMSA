import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { findById } from "@/lib/db/store";
import { getProfileView } from "@/lib/data/profile";
import { ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { EmptyState } from "@/components/ui/skeleton";
import { EditProfileForm, type EditProfileValues } from "@/components/profile/edit-profile-form";

export const metadata = { title: "Edit profile" };

export default async function EditProfilePage(props: PageProps<"/user/[username]/edit">) {
  const { username } = await props.params;
  await requireUser(`/user/${username}/edit`);
  const view = await getProfileView(decodeURIComponent(username));
  if (!view) notFound();
  const base = `/user/${view.user.username}`;

  if (!view.canEdit) {
    return (
      <EmptyState
        icon={<Icon.Lock />}
        title="You can only edit your own profile."
        description="Ask a moderator if something on this profile needs to change."
        action={
          <ButtonLink href={base} variant="outline" size="sm">
            Back to profile
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
