import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
      <p className="text-sm font-semibold uppercase tracking-wider text-accent">404</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink">Page not found</h1>
      <p className="mt-2 max-w-md text-sm text-ink-muted">The page you are looking for doesn&apos;t exist or has been moved.</p>
      <Link href="/" className={buttonClasses({ className: "mt-6" })}>
        Back to home
      </Link>
    </div>
  );
}
