import { PublicI18n } from "@/components/catalog/public-i18n";

/** The batch dashboard reuses the learner-facing assessment list and feedback stars, which read `public` messages. */
export default function AdminBatchLayout({ children }: LayoutProps<"/admin/batches/[id]">) {
  return <PublicI18n pick={["batches.assessments.", "shared.rating.", "certificates.stars."]}>{children}</PublicI18n>;
}
