import { OG_CONTENT_TYPE, renderFallbackOgCard, renderOgCard } from "@/components/seo/og-card";
import { getSettings } from "@/lib/db/store";
import { getProfileView } from "@/lib/data/profile";
import { loadAvatarDataUri } from "@/lib/seo/avatar-image";
import { OG_IMAGE_SIZE } from "@/lib/seo/metadata";
import { initialsColor, isIndexableProfileFor, profileCardContent } from "@/lib/seo/profile-card";
import { decodeSegment } from "@/lib/seo/site";

export const alt = "Member profile: name, headline, picture, certificates and badges";
export const size = OG_IMAGE_SIZE;
export const contentType = OG_CONTENT_TYPE;

/**
 * Share card for `/user/<username>`. Only profiles that are public landing
 * pages (people teaching a published course, while guests may browse) get a
 * personal card; every other profile, missing or disabled member gets the
 * site's default card, so a link preview never reveals a learner's name.
 */
export default async function ProfileOpengraphImage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  const name = decodeSegment(username);
  const [settings, view] = await Promise.all([getSettings(), name ? getProfileView(name) : Promise.resolve(null)]);
  if (!view || !isIndexableProfileFor(view, settings)) return renderFallbackOgCard();

  const { user, stats } = view;
  const content = profileCardContent({ user, stats }, { certifications: settings.features.certifications, badges: settings.features.badges });
  const avatar = await loadAvatarDataUri(user.avatarUrl);
  return renderOgCard({
    ...content,
    avatar: { name: user.name || user.username, src: avatar, color: initialsColor(user.name || user.username) },
  });
}
