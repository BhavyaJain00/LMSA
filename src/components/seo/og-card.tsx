import { ImageResponse } from "next/og";
import { getSettings } from "@/lib/db/store";
import { clampText } from "@/lib/seo/text";
import { OG_IMAGE_SIZE } from "@/lib/seo/metadata";
import { OG_CACHE_CONTROL, OG_FALLBACK_CACHE_CONTROL, singleEntryMemo } from "@/lib/seo/og-cache";
import { initials } from "@/lib/utils";

/**
 * Generated 1200×630 share cards (`opengraph-image` routes). One layout for
 * every content type: brand mark and name, an eyebrow (content type and
 * category), the title, a short summary and a row of facts (instructor,
 * rating, lessons, price, dates). Rendered by `next/og` (Satori), so every
 * element with several children uses flexbox and icons are inline SVG.
 *
 * Cards are sent with shared-cache headers, and the site card (also the
 * fallback for missing or private items) is rendered once per brand
 * configuration and served from memory (see lib/seo/og-cache.ts).
 */

export const OG_CONTENT_TYPE = "image/png";

export interface OgCardInput {
  /** Small label above the title, e.g. "Course · Web development". */
  eyebrow?: string;
  title: string;
  summary?: string;
  /** Facts shown along the bottom, e.g. ["By Maya Patel", "24 lessons", "Free"]. */
  facts?: string[];
  /** Average rating 1–5 with its review count (shown with a star). */
  rating?: { value: number; count: number } | null;
  /**
   * A person's picture beside the title (profiles). `src` must be a `data:`
   * URI (see `loadAvatarDataUri`): the renderer never downloads anything.
   * Without one, the initials are drawn on `color`.
   */
  avatar?: { name: string; src?: string | null; color?: string };
}

const AVATAR_SIZE = 200;

function AvatarCircle({ avatar, accent }: { avatar: NonNullable<OgCardInput["avatar"]>; accent: string }) {
  const frame = {
    display: "flex",
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: 999,
    border: `6px solid ${accent}`,
    overflow: "hidden",
  } as const;
  const src = avatar.src && avatar.src.startsWith("data:image/") ? avatar.src : null;
  if (src) {
    return (
      <div style={frame}>
        {/* eslint-disable-next-line @next/next/no-img-element -- rendered to PNG by next/og, not a page element */}
        <img src={src} width={AVATAR_SIZE - 12} height={AVATAR_SIZE - 12} alt="" style={{ objectFit: "cover", borderRadius: 999 }} />
      </div>
    );
  }
  return (
    <div style={{ ...frame, background: avatar.color && HEX.test(avatar.color) ? avatar.color : "#334155", color: "#ffffff", fontSize: 80, fontWeight: 700, letterSpacing: -1 }}>
      {initials(avatar.name)}
    </div>
  );
}

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const FALLBACK_ACCENT = "#4f46e5";

function accentOf(value: string | undefined): string {
  return value && HEX.test(value.trim()) ? value.trim() : FALLBACK_ACCENT;
}

/** Title size that keeps long titles within three lines. */
function titleSize(title: string): number {
  if (title.length > 80) return 52;
  if (title.length > 48) return 60;
  return 72;
}

function Star({ color }: { color: string }) {
  return (
    <svg width="30" height="30" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6-4.9-4.6 6.6-.8L12 2.5z" fill={color} />
    </svg>
  );
}

function Fact({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 20px",
        borderRadius: 999,
        background: "rgba(255,255,255,0.08)",
        border: "1px solid rgba(255,255,255,0.14)",
        color: "#e5e7eb",
        fontSize: 26,
      }}
    >
      {children}
    </div>
  );
}

/** Render a share card with the site's brand name and accent color. */
export async function renderOgCard(input: OgCardInput, cacheControl: string = OG_CACHE_CONTROL): Promise<ImageResponse> {
  const settings = await getSettings();
  const accent = accentOf(settings.brand.accentColor);
  const brand = clampText(settings.brand.name || "LearnLoop", 40);
  const title = clampText(input.title || brand, 110);
  const summary = input.summary ? clampText(input.summary, 150) : "";
  const facts = (input.facts ?? []).map((f) => clampText(f, 40)).filter(Boolean).slice(0, 4);
  const rating = input.rating && input.rating.count > 0 && input.rating.value > 0 ? input.rating : null;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "64px 72px",
          background: `radial-gradient(circle at 88% 12%, ${accent} 0%, rgba(11,16,32,0) 46%), linear-gradient(135deg, #0b1020 0%, #111827 100%)`,
          color: "#ffffff",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 64, height: 64, borderRadius: 16, background: accent }}>
              <svg width="44" height="44" viewBox="6 5 52 52" xmlns="http://www.w3.org/2000/svg">
                <path d="M32 16 12 26l20 10 20-10-20-10Z" fill="#ffffff" />
                <path d="M20 31.5V40c0 3.3 5.4 6 12 6s12-2.7 12-6v-8.5l-12 6-12-6Z" fill="#ffffff" opacity="0.9" />
                <path d="M50 26v12" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" />
              </svg>
            </div>
            <div style={{ display: "flex", fontSize: 32, fontWeight: 700, letterSpacing: -0.5 }}>{brand}</div>
          </div>
          {input.eyebrow ? (
            <div style={{ display: "flex", padding: "10px 22px", borderRadius: 999, background: "rgba(255,255,255,0.12)", fontSize: 24, color: "#f3f4f6" }}>
              {clampText(input.eyebrow, 48)}
            </div>
          ) : null}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 48 }}>
          {input.avatar ? <AvatarCircle avatar={input.avatar} accent={accent} /> : null}
          <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, flexShrink: 1, gap: 20 }}>
            <div style={{ display: "flex", fontSize: input.avatar ? Math.min(64, titleSize(title)) : titleSize(title), fontWeight: 800, lineHeight: 1.08, letterSpacing: -1.5 }}>{title}</div>
            {summary ? <div style={{ display: "flex", fontSize: 30, lineHeight: 1.35, color: "#cbd5e1" }}>{summary}</div> : null}
          </div>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 14 }}>
          {rating && (
            <Fact>
              <Star color="#fbbf24" />
              <span>{`${rating.value.toFixed(1)} (${rating.count} ${rating.count === 1 ? "review" : "reviews"})`}</span>
            </Fact>
          )}
          {facts.map((f, i) => (
            <Fact key={i}>{f}</Fact>
          ))}
          <div style={{ display: "flex", flexGrow: 1 }} />
          <div style={{ display: "flex", width: 120, height: 8, borderRadius: 999, background: accent }} />
        </div>
      </div>
    ),
    { ...OG_IMAGE_SIZE, headers: { "Cache-Control": cacheControl } },
  );
}

const siteCard = singleEntryMemo<ArrayBuffer>();

async function siteCardResponse(cacheControl: string): Promise<Response> {
  const settings = await getSettings();
  const input: OgCardInput = { title: settings.brand.tagline || settings.brand.name, summary: settings.seo.defaultDescription || settings.brand.metaDescription };
  const key = JSON.stringify([settings.brand.name, settings.brand.accentColor, input.title, input.summary]);
  const png = await siteCard.get(key, async () => (await renderOgCard(input)).arrayBuffer());
  return new Response(png.slice(0), { headers: { "Content-Type": OG_CONTENT_TYPE, "Cache-Control": cacheControl } });
}

/** Card for the site itself (brand, tagline and description), rendered once per brand configuration. */
export function renderSiteOgCard(): Promise<Response> {
  return siteCardResponse(OG_CACHE_CONTROL);
}

/**
 * Card for items that do not exist, are not public or whose section guests
 * can't browse: the site card (never leaks private titles), served from
 * memory with a short cache so a newly published item soon gets its own.
 */
export function renderFallbackOgCard(): Promise<Response> {
  return siteCardResponse(OG_FALLBACK_CACHE_CONTROL);
}
