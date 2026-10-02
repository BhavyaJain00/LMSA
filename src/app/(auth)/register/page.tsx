import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { safeRedirectPath } from "@/lib/auth/redirects";
import { getSettings } from "@/lib/db/store";
import { Markdown } from "@/lib/markdown";
import { clampMinLength } from "@/lib/auth/password-policy";
import { legalLinks } from "@/lib/legal/links";
import { agreementDocuments } from "@/lib/legal/agreement";
import { getT } from "@/i18n/server";
import { RegisterForm } from "./register-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("auth");
  return { title: t("register.metaTitle") };
}

export default async function RegisterPage(props: PageProps<"/register">) {
  const user = await getCurrentUser();
  const sp = await props.searchParams;
  const next = safeRedirectPath(sp.next, undefined);
  if (user) redirect("/dashboard");
  const [settings, links, t] = await Promise.all([getSettings(), legalLinks(), getT("auth")]);

  return (
    <div className="w-full max-w-md">
      <div className="rounded-2xl border border-border bg-surface-1 p-6 shadow-card sm:p-8">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{t("register.title")}</h1>
        <p className="mt-1 text-sm text-ink-muted">{t("register.subtitle", { brand: settings.brand.name })}</p>
        {settings.customSignupContent && (
          <div className="mt-4 rounded-lg bg-surface-2 p-3 text-sm">
            <Markdown content={settings.customSignupContent} />
          </div>
        )}
        <div className="mt-6">
          {settings.learning.disableSignup ? (
            <p className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">{t("register.disabled")}</p>
          ) : (
            <RegisterForm next={next} minLength={clampMinLength(settings.security.passwordMinLength)} legal={agreementDocuments("register", links)} />
          )}
        </div>
      </div>
      <p className="mt-4 text-center text-sm text-ink-muted">
        {t.rich("register.loginPrompt", {
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
