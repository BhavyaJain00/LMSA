import { PublicI18n } from "@/components/catalog/public-i18n";

/** Hands the `public` messages that the pricing error screen (a client component) reads to the browser. */
export default function PricingLayout({ children }: LayoutProps<"/pricing">) {
  return <PublicI18n pick={["errors.", "catalog.browseCourses"]}>{children}</PublicI18n>;
}
