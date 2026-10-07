import { AdminI18n } from "@/components/admin/i18n";

/**
 * Admin shell: makes the `admin` messages every admin page's client
 * components read with `useT("admin")` available below /admin (error
 * boundaries, shared words, the member picker). Sections with more client
 * text (settings, members) add their own slices in their layouts; see
 * `src/components/admin/i18n-slices.ts`. Server-only text (the `pages.`
 * slice) stays on the server; every page re-checks roles itself.
 */
export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return <AdminI18n section="base">{children}</AdminI18n>;
}
