import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { getSettings } from "@/lib/db/store";
import { getCertificationCategories, getCertifiedMembers } from "@/lib/data/certificates";
import { PageHeader } from "@/components/ui/card";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/skeleton";
import { Icon } from "@/components/ui/icons";
import { Breadcrumbs } from "@/components/assessments/breadcrumbs";
import { FilterBar, ListFooter } from "@/components/assessments/list-controls";
import { param, parsePaging } from "@/components/assessments/shared";
import { CertifiedMemberCard } from "@/components/certificates/member-card";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("public");
  return { title: t("members.title"), description: t("members.metaDescription") };
}

export default async function CertifiedMembersPage(props: PageProps<"/certified-members">) {
  const [settings, t] = await Promise.all([getSettings(), getT("public")]);
  if (!settings.features.certifications || !settings.features.certifiedMembers) notFound();
  // The directory is for logged-in members; guests are sent to the course catalog.
  const viewer = await getCurrentUser();
  if (!viewer) redirect("/courses");
  const sp = await props.searchParams;
  const name = param(sp.name);
  const category = param(sp.category);
  const openToWork = param(sp["open-to-work"]) === "true";
  const hiring = param(sp.hiring) === "true";
  const { size, pages, limit } = parsePaging(sp.size, sp.pages);

  const [members, categories] = await Promise.all([getCertifiedMembers({ name, category, openToWork, hiring }), getCertificationCategories()]);
  const shown = members.slice(0, limit);
  const filtered = !!(name || category || openToWork || hiring);

  return (
    <div className="animate-fade-in">
      <PageHeader
        breadcrumbs={<Breadcrumbs items={[{ label: t("members.title") }]} />}
        title={t("members.count", { count: members.length })}
        description={t("members.description", { brand: settings.brand.name })}
        actions={
          <ButtonLink href="/courses?certification=true" variant="outline" leftIcon={<Icon.GraduationCap className="size-4" />}>
            {t("enroll.getCertified")}
          </ButtonLink>
        }
      />
      <FilterBar
        filters={[
          { param: "name", kind: "search", label: t("members.search"), placeholder: t("members.search") },
          { param: "category", kind: "select", label: t("catalog.filters.category"), placeholder: t("catalog.filters.category"), options: categories.map((c) => ({ value: c, label: c })), className: "sm:w-72" },
          { param: "open-to-work", kind: "toggle", label: t("members.openToWork"), tone: "success" },
          { param: "hiring", kind: "toggle", label: t("members.hiring"), tone: "accent" },
        ]}
      />
      {members.length === 0 ? (
        <EmptyState
          icon={<Icon.ShieldCheck />}
          title={filtered ? t("members.noMatchTitle") : t("members.emptyTitle")}
          description={filtered ? (openToWork || hiring ? t("members.noMatchToggles") : t("members.noMatch")) : t("members.emptyDescription")}
          action={
            <ButtonLink href="/courses?certification=true" leftIcon={<Icon.GraduationCap className="size-4" />}>
              {t("certification.none.browse")}
            </ButtonLink>
          }
        />
      ) : (
        <>
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {shown.map((m) => (
              <li key={m.user.id}>
                <CertifiedMemberCard member={m} />
              </li>
            ))}
          </ul>
          <ListFooter shown={shown.length} total={members.length} size={size} pages={pages} noun={t("members.noun")} />
        </>
      )}
    </div>
  );
}
