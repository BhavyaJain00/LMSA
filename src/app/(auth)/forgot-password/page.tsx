import Link from "next/link";
import { getSettings } from "@/lib/db/store";
import { ForgotPasswordForm } from "./forgot-password-form";

export const metadata = { title: "Reset your password" };

export default async function ForgotPasswordPage(props: PageProps<"/forgot-password">) {
  const sp = await props.searchParams;
  const email = typeof sp.email === "string" ? sp.email.trim().slice(0, 254) : undefined;
  const settings = await getSettings();

  return (
    <div className="w-full max-w-md">
      <div className="rounded-2xl border border-border bg-surface-1 p-6 shadow-card sm:p-8">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Forgot your password?</h1>
        <p className="mt-1 text-sm text-ink-muted">Enter the email you use for {settings.brand.name} and we&apos;ll send you a link to choose a new password.</p>
        <div className="mt-6">
          <ForgotPasswordForm defaultEmail={email} />
        </div>
      </div>
      <p className="mt-4 text-center text-sm text-ink-muted">
        Remembered it?{" "}
        <Link href="/login" className="font-medium text-accent hover:underline">
          Log in
        </Link>
      </p>
    </div>
  );
}
