import { PublicI18n } from "@/components/catalog/public-i18n";

/** Hands the `public` messages that the program pages' client components (and `error.tsx`) read to the browser. */
export default function ProgramsLayout({ children }: LayoutProps<"/programs">) {
  return <PublicI18n pick={["errors.", "catalog.browseCourses", "programs.", "enroll."]}>{children}</PublicI18n>;
}
