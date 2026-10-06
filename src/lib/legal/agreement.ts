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

/** One piece of the document list: a document (rendered as a link) or the text between documents. */
export type AgreementPart = { type: "document"; index: number } | { type: "text"; value: string };

/**
 * The document list in the reader's language ("A, B, and C", "A, B y C",
 * "A, B et C"), split so the documents can be rendered as links. Falls back
 * to the English separators when `Intl.ListFormat` cannot handle the locale.
 */
export function agreementListParts(count: number, locale: string): AgreementPart[] {
  if (count <= 0) return [];
  const items = Array.from({ length: count }, (_, i) => `\u0001${i}\u0001`);
  try {
    const parts = new Intl.ListFormat(locale, { style: "long", type: "conjunction" }).formatToParts(items);
    let next = 0;
    return parts.map((p): AgreementPart => (p.type === "element" ? { type: "document", index: next++ } : { type: "text", value: p.value }));
  } catch {
    return items.flatMap((_, i): AgreementPart[] => {
      const sep = listSeparator(i, count);
      return sep ? [{ type: "text", value: sep }, { type: "document", index: i }] : [{ type: "document", index: i }];
    });
  }
}

/**
 * Article between the lead and the list. English reads "you agree to the
 * Terms of Service"; the translated leads already end where the list begins.
 */
export function agreementArticle(locale: string): string {
  return /^en(?:-|$)/i.test(locale) ? "the " : "";
}
