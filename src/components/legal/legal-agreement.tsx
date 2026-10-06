"use client";

import Link from "next/link";
import { agreementArticle, agreementListParts, type AgreementLink } from "@/lib/legal/agreement";
import { intlLocale } from "@/i18n/config";
import { useLocale } from "@/i18n/client";
import { cn } from "@/lib/utils";

/**
 * "By creating an account you agree to the Terms of Service and Privacy
 * Policy." `lead` comes translated from the form; the list of documents is
 * joined with the reader's own conjunction (`Intl.ListFormat`), so a Spanish
 * sentence reads "… aceptas Términos y Privacidad", not "… the Términos and …".
 * Links open in a new tab so nothing typed into the surrounding form is lost.
 * Renders nothing when none of the documents is published.
 *
 * Pass the output of `agreementDocuments()`.
 */
export function LegalAgreement({ documents, lead, className }: { documents: readonly AgreementLink[]; lead: string; className?: string }) {
  const locale = intlLocale(useLocale());
  if (!documents.length) return null;
  const parts = agreementListParts(documents.length, locale);
  return (
    <p className={cn("text-xs text-ink-faint", className)}>
      {lead} {agreementArticle(locale)}
      {parts.map((part, i) => {
        if (part.type === "text") return <span key={`t${i}`}>{part.value}</span>;
        const doc = documents[part.index];
        if (!doc) return null;
        return (
          <Link key={doc.slug} href={doc.href} target="_blank" rel="noopener" className="font-medium text-ink-muted underline underline-offset-2 hover:text-ink">
            {doc.title}
            <span className="sr-only"> (opens in a new tab)</span>
          </Link>
        );
      })}
      .
    </p>
  );
}
