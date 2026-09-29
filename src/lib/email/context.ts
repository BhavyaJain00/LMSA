import "server-only";
import type { Settings } from "@/lib/types";
import { getSettings } from "@/lib/db/store";
import { siteConfig } from "@/lib/config";
import { normalizeHexColor, readableTextColor, safeImageUrl } from "./html";
import type { EmailBrand } from "./templates/layout";

/** Brand context for email templates, derived from Settings (pure). */
export function brandFromSettings(settings: Settings, appUrl: string = siteConfig.appUrl): EmailBrand {
  const accent = normalizeHexColor(settings.brand.accentColor) ?? "#4f46e5";
  const logo = settings.brand.logoUrl ? safeImageUrl(settings.brand.logoUrl, appUrl) : null;
  return {
    name: settings.brand.name?.trim() || siteConfig.name,
    accentColor: accent,
    accentTextColor: readableTextColor(accent),
    logoUrl: logo ?? undefined,
    appUrl: appUrl.replace(/\/+$/, ""),
    footerText: settings.email.footerText?.trim() || undefined,
    contactEmail: settings.contact.email?.trim() || undefined,
    dir: settings.textDirection,
  };
}

export async function getEmailBrand(): Promise<EmailBrand> {
  return brandFromSettings(await getSettings());
}
