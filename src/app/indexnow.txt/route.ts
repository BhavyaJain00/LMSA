import { timingSafeEqual } from "node:crypto";
import { getSettings } from "@/lib/db/store";
import { isValidIndexNowKey } from "@/lib/seo/indexnow";

/**
 * GET /indexnow.txt — the IndexNow key file. Search engines fetch it to
 * confirm that a submission really comes from this site; every submission
 * names this address as its `keyLocation`.
 *
 * The proxy also maps `/<key>.txt` here (as `?key=<key>`), the protocol's
 * default location: that form only answers when the name is the configured key.
 */
export const dynamic = "force-dynamic";

function sameKey(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function GET(request: Request) {
  const { seo } = await getSettings();
  const key = seo.indexNowKey;
  const requested = new URL(request.url).searchParams.get("key");
  if (!isValidIndexNowKey(key) || (requested !== null && !sameKey(requested, key))) {
    return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  return new Response(key, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=300",
      "X-Robots-Tag": "noindex",
    },
  });
}
