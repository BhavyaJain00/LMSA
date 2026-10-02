import { PublicI18n } from "@/components/catalog/public-i18n";

/** Hands the `public` messages that the legal page error screen (a client component) reads to the browser. */
export default function LegalLayout({ children }: LayoutProps<"/legal/[slug]">) {
  return <PublicI18n pick={["errors."]}>{children}</PublicI18n>;
}
