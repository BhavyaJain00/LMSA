import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getSettings } from "@/lib/db/store";
import { getProfileCertificates, getProfileView } from "@/lib/data/profile";
import { ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { EmptyState } from "@/components/ui/skeleton";
import { CertificateGrid } from "@/components/profile/profile-sections";
import { getT } from "@/i18n/server";

export async function generateMetadata() {
  return { title: (await getT("account"))("profile.tabs.certificates") };
}

export default async function ProfileCertificatesPage(props: PageProps<"/user/[username]/certificates">) {
  const { username } = await props.params;
  await requireUser(`/user/${username}/certificates`);
  const [view, settings, t] = await Promise.all([getProfileView(decodeURIComponent(username)), getSettings(), getT("account")]);
  if (!view || !settings.features.certifications) notFound();
  const certificates = await getProfileCertificates(view.user.id);

  return (
    <section aria-labelledby="certificates-title">
      <h2 id="certificates-title" className="mb-4 text-lg font-semibold tracking-tight text-ink">
        {t("profile.tabs.certificates")}
      </h2>
      {certificates.length === 0 ? (
        <EmptyState
          compact
          icon={<Icon.Certificate />}
          title={view.isSelf ? t("profile.certificates.emptySelf") : t("profile.certificates.emptyOther", { name: view.user.name })}
          description={view.isSelf ? t("profile.certificates.emptyHint") : undefined}
          action={
            view.isSelf ? (
              <ButtonLink href="/courses" size="sm">
                {t("profile.certificates.findCourse")}
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
