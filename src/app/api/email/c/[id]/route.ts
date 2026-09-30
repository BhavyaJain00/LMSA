import { after, type NextRequest } from "next/server";
import { siteConfig } from "@/lib/config";
import { getSettings } from "@/lib/db/store";
import { escapeHtml } from "@/lib/email/html";
import { recordEmailHit, verifyClickParams } from "@/lib/comms/tracking";

/**
 * Click redirect: GET /api/email/c/<emailId>?u=<destination>&s=<signature>
 *
 * The signature covers the outbox message id and the exact destination, so
 * this endpoint only ever redirects to a URL that was written into that
 * email — a tampered or foreign `u` gets an error page, never a redirect
 * (no open redirect). Valid clicks are recorded after the response is sent;
 * HEAD probes (link scanners) and clicks from inside the app (staff previews)
 * are not counted.
 */

export const dynamic = "force-dynamic";

const NO_STORE = "no-store, max-age=0, private";

function redirectTo(url: string): Response {
  // `href` percent-encodes anything a header value can't carry; it is the same URL.
  return new Response(null, {
    status: 302,
    headers: { Location: new URL(url).href, "Cache-Control": NO_STORE, "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow" },
  });
}

async function invalidLink(): Promise<Response> {
  const home = escapeHtml(`${siteConfig.appUrl}/`);
  const name = escapeHtml((await getSettings().catch(() => null))?.brand.name || siteConfig.name);
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex, nofollow" />
<title>Link unavailable · ${name}</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 16px; font: 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; background: #f7f7f8; color: #18181b; }
  main { max-width: 420px; text-align: center; }
  h1 { font-size: 1.25rem; margin: 0 0 8px; }
  p { margin: 0 0 20px; color: #52525b; }
  a { display: inline-block; padding: 10px 18px; border-radius: 10px; background: #18181b; color: #fff; text-decoration: none; font-weight: 600; }
  a:focus-visible { outline: 3px solid #6366f1; outline-offset: 2px; }
  @media (prefers-color-scheme: dark) { body { background: #0b0b0d; color: #f4f4f5; } p { color: #a1a1aa; } a { background: #f4f4f5; color: #18181b; } }
</style>
</head>
<body>
<main>
  <h1>This link can't be opened</h1>
  <p>The link is incomplete or was changed after the email was sent. Open the original email and try the link again, or continue to ${name}.</p>
  <a href="${home}">Go to ${name}</a>
</main>
</body>
</html>`;
  return new Response(html, {
    status: 400,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": NO_STORE, "X-Robots-Tag": "noindex, nofollow", "Referrer-Policy": "no-referrer" },
  });
}

async function resolve(request: NextRequest, ctx: RouteContext<"/api/email/c/[id]">): Promise<{ emailId: string; url: string } | null> {
  const { id } = await ctx.params;
  const url = request.nextUrl.searchParams.get("u");
  const signature = request.nextUrl.searchParams.get("s");
  if (!url || !verifyClickParams(id, url, signature)) return null;
  return { emailId: id, url };
}

export async function GET(request: NextRequest, ctx: RouteContext<"/api/email/c/[id]">) {
  const target = await resolve(request, ctx);
  if (!target) return invalidLink();
  if (request.headers.get("sec-fetch-site") !== "same-origin") {
    after(async () => {
      try {
        await recordEmailHit(target.emailId, { type: "click", url: target.url });
      } catch (error) {
        console.error("[email tracking] could not record a click:", error instanceof Error ? error.message : String(error));
      }
    });
  }
  return redirectTo(target.url);
}

export async function HEAD(request: NextRequest, ctx: RouteContext<"/api/email/c/[id]">) {
  const target = await resolve(request, ctx);
  return target ? redirectTo(target.url) : new Response(null, { status: 400, headers: { "Cache-Control": NO_STORE } });
}
