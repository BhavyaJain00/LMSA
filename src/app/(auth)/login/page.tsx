import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { getSettings } from "@/lib/db/store";
import { LoginForm } from "./login-form";

export const metadata = { title: "Log in" };

export default async function LoginPage(props: PageProps<"/login">) {
  const user = await getCurrentUser();
  const sp = await props.searchParams;
  const next = typeof sp.next === "string" && sp.next.startsWith("/") && !sp.next.startsWith("//") ? sp.next : undefined;
  const email = typeof sp.email === "string" ? sp.email.slice(0, 254) : undefined;
  if (user) redirect(next ?? "/dashboard");
  const settings = await getSettings();

  return (
    <div className="w-full max-w-md">
      <div className="rounded-2xl border border-border bg-surface-1 p-6 shadow-card sm:p-8">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Welcome back</h1>
        <p className="mt-1 text-sm text-ink-muted">Log in to continue learning on {settings.brand.name}.</p>
        <div className="mt-6">
          <LoginForm next={next} defaultEmail={email} />
        </div>
      </div>
      {!settings.learning.disableSignup && (
        <p className="mt-4 text-center text-sm text-ink-muted">
          New here?{" "}
          <Link href={next ? `/register?next=${encodeURIComponent(next)}` : "/register"} className="font-medium text-accent hover:underline">
            Create an account
          </Link>
        </p>
      )}
      <div className="mt-6 rounded-xl border border-dashed border-border-strong bg-surface-2/60 p-4 text-xs text-ink-muted">
        <p className="mb-1.5 font-medium text-ink">Demo accounts (password: password123)</p>
        <ul className="grid grid-cols-2 gap-x-4 gap-y-1">
          <li>
            <span className="font-medium">Admin</span> · admin@learnloop.test
          </li>
          <li>
            <span className="font-medium">Instructor</span> · maya@learnloop.test
          </li>
          <li>
            <span className="font-medium">Evaluator</span> · priya@learnloop.test
          </li>
          <li>
            <span className="font-medium">Student</span> · alex@learnloop.test
          </li>
        </ul>
      </div>
    </div>
  );
}
