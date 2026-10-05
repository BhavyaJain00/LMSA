import type { Settings } from "@/lib/types";
import { guestsCanBrowse } from "./visibility";

/**
 * Member profiles in search and on social networks (pure, shared by the
 * profile page metadata, its generated share card and tests).
 *
 * Profiles of people who teach a published course are public landing pages
 * (indexed, with ProfilePage/Person markup and a generated share card);
 * learner profiles stay out of the index and share the site's default card,
 * so joining the platform never puts someone's name in search results or
 * link previews.
 */

export interface ProfileIndexFacts {
  user: { enabled: boolean };
  stats: { teaching: number };
}

export function isIndexableProfile(view: ProfileIndexFacts, guestsBrowse: boolean): boolean {
  return guestsBrowse && view.user.enabled && view.stats.teaching > 0;
}

/** Same decision straight from the settings. */
export function isIndexableProfileFor(view: ProfileIndexFacts, settings: Pick<Settings, "learning">): boolean {
  return isIndexableProfile(view, guestsCanBrowse(settings));
}

export interface ProfileCardSource {
  user: { name: string; username: string; headline?: string; bio?: string };
  stats: { teaching: number; certificates: number; badges: number; completed: number };
}

export interface ProfileCardFeatures {
  certifications: boolean;
  badges: boolean;
}

export interface ProfileCardContent {
  eyebrow: string;
  title: string;
  summary?: string;
  facts: string[];
}

function count(n: number, singular: string, plural = `${singular}s`): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? singular : plural}`;
}

/** First sentence-ish of a markdown bio, for profiles without a headline. */
export function bioSummary(bio: string | undefined, max = 150): string {
  if (!bio) return "";
  const plain = bio
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_`~|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (plain.length <= max) return plain;
  const cut = plain.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:–—-]+$/, "")}…`;
}

/**
 * Text of a member's share card: name, headline (or the start of the bio)
 * and the numbers worth showing (courses taught, certificates, badges,
 * courses completed), skipping zeros and disabled features.
 */
export function profileCardContent(source: ProfileCardSource, features: ProfileCardFeatures): ProfileCardContent {
  const { user, stats } = source;
  const facts: string[] = [];
  if (stats.teaching > 0) facts.push(count(stats.teaching, "course taught", "courses taught"));
  if (features.certifications && stats.certificates > 0) facts.push(count(stats.certificates, "certificate"));
  if (features.badges && stats.badges > 0) facts.push(count(stats.badges, "badge"));
  if (facts.length < 3 && stats.completed > 0) facts.push(count(stats.completed, "course completed", "courses completed"));
  const headline = user.headline?.trim();
  const summary = headline || bioSummary(user.bio) || undefined;
  return {
    eyebrow: stats.teaching > 0 ? "Instructor" : "Member",
    title: user.name.trim() || `@${user.username}`,
    summary,
    facts: [...facts.slice(0, 3), `@${user.username}`],
  };
}

/* ------------------------------------------------------------------ */
/* Avatar images                                                      */
/* ------------------------------------------------------------------ */

/** Largest avatar file embedded in a share card. */
export const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

/**
 * Image type from the file's first bytes. Only PNG and JPEG: the formats the
 * card renderer decodes reliably. The name or a stored content type is never
 * trusted, so a renamed file of another kind is skipped (initials are shown).
 */
export function sniffAvatarMime(bytes: Uint8Array): "image/png" | "image/jpeg" | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  return null;
}

/** `data:` URI for an avatar file, or null when it is empty, too large or not a PNG/JPEG. */
export function avatarDataUri(bytes: Uint8Array): string | null {
  if (!bytes.length || bytes.length > MAX_AVATAR_BYTES) return null;
  const mime = sniffAvatarMime(bytes);
  if (!mime) return null;
  return `data:${mime};base64,${Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64")}`;
}

/**
 * Deterministic background color for initials: the hue the `Avatar`
 * component picks (hsl(h 55% 45%)), as a hex color the card renderer accepts.
 */
export function initialsColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  const s = 0.55;
  const l = 0.45;
  const a = s * Math.min(l, 1 - l);
  const channel = (n: number) => {
    const k = (n + hue / 30) % 12;
    const v = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(v * 255)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}
