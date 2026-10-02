import { PublicI18n } from "@/components/catalog/public-i18n";

/** Hands the `public` messages that the batch pages' client components (and `error.tsx`) read to the browser. */
export default function BatchesLayout({ children }: LayoutProps<"/batches">) {
  return <PublicI18n pick={["errors.", "batches.", "certificates.", "shared.rating."]}>{children}</PublicI18n>;
}
