import type { Metadata } from "next";
import Link from "next/link";
import { getSettings } from "@/lib/db/store";
import { getCurrentUser } from "@/lib/auth/session";
import { Icon } from "@/components/ui/icons";
import { VerifyForm } from "@/components/certificates/verify-form";

export const metadata: Metadata = { title: "Verify a certificate" };

export default async function VerifyCertificatePage() {
  const [settings, viewer] = await Promise.all([getSettings(), getCurrentUser()]);
  // The directory is members-only (guests are redirected away), so only offer it to logged-in viewers.
  const showDirectory = !!viewer && settings.features.certifications && settings.features.certifiedMembers;
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center py-10 text-center">
      <span className="flex size-14 items-center justify-center rounded-full bg-accent/10 text-accent">
        <Icon.ShieldCheck className="size-7" />
      </span>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight text-ink">Verify a certificate</h1>
      <p className="mt-2 text-sm text-ink-muted">
        Every certificate issued by {settings.brand.name} has a unique ID printed at the bottom. Enter it below to confirm the certificate is genuine.
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
