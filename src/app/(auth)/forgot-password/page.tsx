import type { Metadata } from "next";
import Link from "next/link";
import { getSettings } from "@/lib/db/store";
import { getT } from "@/i18n/server";
import { ForgotPasswordForm } from "./forgot-password-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("auth");
  return { title: t("forgot.metaTitle") };
}

export default async function ForgotPasswordPage(props: PageProps<"/forgot-password">) {
  const sp = await props.searchParams;
  const email = typeof sp.email === "string" ? sp.email.trim().slice(0, 254) : undefined;
  const [settings, t] = await Promise.all([getSettings(), getT("auth")]);

  return (
    <div className="w-full max-w-md">
      <div className="rounded-2xl border border-border bg-surface-1 p-6 shadow-card sm:p-8">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{t("forgot.title")}</h1>
        <p className="mt-1 text-sm text-ink-muted">{t("forgot.subtitle", { brand: settings.brand.name })}</p>
        <div className="mt-6">
          <ForgotPasswordForm defaultEmail={email} />
        </div>
      </div>
      <p className="mt-4 text-center text-sm text-ink-muted">
        {t.rich("forgot.remembered", {
          link: (text) => (
            <Link href="/login" className="font-medium text-accent hover:underline">
              {text}
            </Link>
          ),
        })}
      </p>
    </div>
  );
}
