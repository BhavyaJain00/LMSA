import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { safeRedirectPath } from "@/lib/auth/redirects";
import { getSettings } from "@/lib/db/store";
import { getT } from "@/i18n/server";
import { LoginForm } from "./login-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("auth");
  return { title: t("login.metaTitle") };
}

const DEMO_ACCOUNTS = [
  { role: "login.demoAdmin", email: "admin@learnloop.test" },
  { role: "login.demoInstructor", email: "maya@learnloop.test" },
  { role: "login.demoEvaluator", email: "priya@learnloop.test" },
  { role: "login.demoStudent", email: "alex@learnloop.test" },
] as const;

export default async function LoginPage(props: PageProps<"/login">) {
  const user = await getCurrentUser();
  const sp = await props.searchParams;
  const next = safeRedirectPath(sp.next, undefined);
  const email = typeof sp.email === "string" ? sp.email.slice(0, 254) : undefined;
  if (user) redirect(next ?? "/dashboard");
  const [settings, t] = await Promise.all([getSettings(), getT("auth")]);

  return (
    <div className="w-full max-w-md">
      <div className="rounded-2xl border border-border bg-surface-1 p-6 shadow-card sm:p-8">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{t("login.title")}</h1>
        <p className="mt-1 text-sm text-ink-muted">{t("login.subtitle", { brand: settings.brand.name })}</p>
        <div className="mt-6">
          <LoginForm next={next} defaultEmail={email} />
        </div>
      </div>
      {!settings.learning.disableSignup && (
        <p className="mt-4 text-center text-sm text-ink-muted">
          {t.rich("login.signupPrompt", {
            link: (text) => (
              <Link href={next ? `/register?next=${encodeURIComponent(next)}` : "/register"} className="font-medium text-accent hover:underline">
                {text}
              </Link>
            ),
          })}
        </p>
      )}
      <div className="mt-6 rounded-xl border border-dashed border-border-strong bg-surface-2/60 p-4 text-xs text-ink-muted">
        <p className="mb-1.5 font-medium text-ink">{t("login.demoTitle", { password: "password123" })}</p>
        <ul className="grid grid-cols-2 gap-x-4 gap-y-1">
          {DEMO_ACCOUNTS.map((account) => (
            <li key={account.email} className="min-w-0 truncate">
              <span className="font-medium">{t(account.role)}</span> · <span dir="ltr">{account.email}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
