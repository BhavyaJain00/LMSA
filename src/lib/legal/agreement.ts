import { CORE_LEGAL_META, type CoreLegalSlug } from "./pages-shared";

/**
 * Which legal pages a visitor agrees to at sign-up and at checkout. Pure (no
 * server imports) so the register form and the billing form can render the
 * sentence on the client from links resolved on the server.
 */

export type AgreementContext = "register" | "checkout";

/** Documents named in the agreement sentence, in reading order. */
export const AGREEMENT_DOCUMENTS: Record<AgreementContext, readonly CoreLegalSlug[]> = {
  register: ["terms", "privacy"],
  checkout: ["terms", "refunds", "privacy"],
};

/** A published legal page as passed to client components (a subset of `LegalLink`). */
export interface AgreementLink {
  slug: string;
  title: string;
  href: string;
}

/**
 * The published documents for a context, in the fixed order above. Pages that
 * are not published are left out, so the sentence never links to a 404 and
 * never asks visitors to accept text they cannot read.
 */
export function agreementDocuments(context: AgreementContext, published: readonly AgreementLink[]): AgreementLink[] {
  const bySlug = new Map(published.map((l) => [l.slug, l]));
  const out: AgreementLink[] = [];
  for (const slug of AGREEMENT_DOCUMENTS[context]) {
    const link = bySlug.get(slug);
    if (link) out.push({ slug: link.slug, title: link.title.trim() || CORE_LEGAL_META[slug].title, href: link.href });
  }
  return out;
}

/** Separator placed before item `index` of a list of `count` items: "", ", ", " and ", ", and ". */
export function listSeparator(index: number, count: number): string {
  if (index === 0) return "";
  if (index < count - 1) return ", ";
  return count > 2 ? ", and " : " and ";
}
