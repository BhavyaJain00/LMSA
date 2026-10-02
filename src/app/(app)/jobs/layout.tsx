import { PublicI18n } from "@/components/catalog/public-i18n";

/** Hands the `public` messages that the job board's client components (and `error.tsx`) read to the browser. */
export default function JobsLayout({ children }: LayoutProps<"/jobs">) {
  return <PublicI18n pick={["errors.", "jobs."]}>{children}</PublicI18n>;
}
