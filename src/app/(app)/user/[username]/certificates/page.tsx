import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getSettings } from "@/lib/db/store";
import { getProfileCertificates, getProfileView } from "@/lib/data/profile";
import { ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { EmptyState } from "@/components/ui/skeleton";
import { CertificateGrid } from "@/components/profile/profile-sections";

export const metadata = { title: "Certificates" };

export default async function ProfileCertificatesPage(props: PageProps<"/user/[username]/certificates">) {
  const { username } = await props.params;
  await requireUser(`/user/${username}/certificates`);
  const [view, settings] = await Promise.all([getProfileView(decodeURIComponent(username)), getSettings()]);
  if (!view || !settings.features.certifications) notFound();
  const certificates = await getProfileCertificates(view.user.id);

  return (
    <section aria-labelledby="certificates-title">
      <h2 id="certificates-title" className="mb-4 text-lg font-semibold tracking-tight text-ink">
        Certificates
      </h2>
      {certificates.length === 0 ? (
        <EmptyState
          compact
          icon={<Icon.Certificate />}
          title={view.isSelf ? "You have not received any certificates yet." : `${view.user.name} has not received any certificates yet.`}
          description={view.isSelf ? "Complete a course with certification enabled, or pass a batch evaluation, to earn one." : undefined}
          action={
            view.isSelf ? (
              <ButtonLink href="/courses" size="sm">
                Find a course
              </ButtonLink>
            ) : undefined
          }
        />
      ) : (
        <CertificateGrid certificates={certificates} />
      )}
    </section>
  );
}
