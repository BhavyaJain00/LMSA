import { PublicI18n } from "@/components/catalog/public-i18n";

/** Hands the `public` messages that the blog error screen (a client component) reads to the browser. */
export default function BlogLayout({ children }: LayoutProps<"/blog">) {
  return <PublicI18n pick={["errors."]}>{children}</PublicI18n>;
}
