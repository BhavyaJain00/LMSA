import { PublicI18n } from "@/components/catalog/public-i18n";

/** Hands the `public` messages that the instructors error screen (a client component) reads to the browser. */
export default function InstructorsLayout({ children }: LayoutProps<"/instructors">) {
  return <PublicI18n pick={["errors.", "catalog.browseCourses"]}>{children}</PublicI18n>;
}
