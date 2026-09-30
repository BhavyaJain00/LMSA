import { type JsonLdObject, serializeJsonLd } from "@/lib/seo/jsonld";

type JsonLdInput = JsonLdObject | null | undefined | false;

/**
 * Structured data block(s). Each object becomes its own
 * `<script type="application/ld+json">`; falsy entries are skipped so pages
 * can pass conditional builders inline. The JSON is serialized by
 * `serializeJsonLd`, which escapes `<`, `>` and `&`, so user content can never
 * close the script element. Server Component (renders static markup only).
 */
export function JsonLd({ data }: { data: JsonLdInput | JsonLdInput[] }) {
  const items = (Array.isArray(data) ? data : [data]).filter((d): d is JsonLdObject => !!d && Object.keys(d).length > 0);
  if (!items.length) return null;
  return (
    <>
      {items.map((item, i) => (
        <script key={i} type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(item) }} />
      ))}
    </>
  );
}
