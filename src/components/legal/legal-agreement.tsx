import Link from "next/link";
import { listSeparator, type AgreementLink } from "@/lib/legal/agreement";
import { cn } from "@/lib/utils";

/**
 * "By creating an account you agree to the Terms of Service and Privacy
 * Policy." Links open in a new tab so nothing typed into the surrounding form
 * is lost. Renders nothing when none of the documents is published.
 *
 * Works in server and client trees (no hooks); pass the output of
 * `agreementDocuments()`.
 */
export function LegalAgreement({ documents, lead, className }: { documents: readonly AgreementLink[]; lead: string; className?: string }) {
  if (!documents.length) return null;
  return (
    <p className={cn("text-xs text-ink-faint", className)}>
      {lead} the{" "}
      {documents.map((doc, i) => (
        <span key={doc.slug}>
          {listSeparator(i, documents.length)}
          <Link href={doc.href} target="_blank" rel="noopener" className="font-medium text-ink-muted underline underline-offset-2 hover:text-ink">
            {doc.title}
            <span className="sr-only"> (opens in a new tab)</span>
          </Link>
        </span>
      ))}
      .
    </p>
  );
}
