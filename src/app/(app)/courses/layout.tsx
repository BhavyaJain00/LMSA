import { PublicI18n } from "@/components/catalog/public-i18n";

/** Hands the `public` messages that the catalog and course pages' client components (and `error.tsx`) read to the browser. */
export default function CoursesLayout({ children }: LayoutProps<"/courses">) {
  return <PublicI18n pick={["errors.", "catalog.", "course.", "outline.", "enroll.", "reviews.", "sales.", "shared.", "certificates."]}>{children}</PublicI18n>;
}
