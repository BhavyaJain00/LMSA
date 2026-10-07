import { AdminI18n } from "@/components/admin/i18n";

/** The API reference's client parts (endpoint browser, code samples) read the `developers.` messages; see `src/components/admin/i18n-slices.ts`. */
export default function DevelopersLayout({ children }: LayoutProps<"/developers">) {
  return <AdminI18n section="developers">{children}</AdminI18n>;
}
