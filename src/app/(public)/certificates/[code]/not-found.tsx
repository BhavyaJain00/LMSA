import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { getSettings } from "@/lib/db/store";
import { Icon } from "@/components/ui/icons";
import { VerifyForm } from "@/components/certificates/verify-form";

/** Invalid or unpublished certificate code. */
export default async function CertificateNotFound() {
  const [settings, viewer] = await Promise.all([getSettings(), getCurrentUser()]);
  // The directory is members-only, so guests are not sent there.
  const showDirectory = !!viewer && settings.features.certifications && settings.features.certifiedMembers;
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center py-10 text-center">
      <span className="flex size-14 items-center justify-center rounded-full bg-danger/10 text-danger">
        <Icon.XCircle className="size-7" />
      </span>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight text-ink">Certificate not found</h1>
      <p className="mt-2 text-sm text-ink-muted">
        We couldn&apos;t find a published certificate with this ID. Check the code on the certificate and try again — it looks like <span className="font-mono">LL-7K2M-Q9ZX</span>.
      </p>
      <div className="mt-6 w-full text-left">
        <VerifyForm />
      </div>
      {showDirectory && (
        <Link href="/certified-members" className="mt-6 text-sm font-medium text-accent hover:underline">
          Browse certified members
        </Link>
      )}
    </div>
  );
}
