import { PublicI18n } from "@/components/catalog/public-i18n";

/** Hands the `public` messages that the bundles error screen (a client component) reads to the browser. */
export default function BundlesLayout({ children }: LayoutProps<"/bundles">) {
  return <PublicI18n pick={["errors.", "catalog.browseCourses"]}>{children}</PublicI18n>;
}
