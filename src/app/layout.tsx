import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { getSettings } from "@/lib/db/store";
import { readFlash } from "@/lib/flash";
import { siteConfig } from "@/lib/config";
import { readConsentCookie } from "@/lib/legal/consent";
import { FlashToast, ToastProvider } from "@/components/ui/toast";
import { themeInitScript } from "@/components/ui/theme-toggle";
import { PwaProvider } from "@/components/pwa/pwa-provider";
import { RootSeo } from "@/components/seo/root-seo";
import { TrackingScripts } from "@/components/seo/tracking-scripts";
import { ConsentManager } from "@/components/legal/consent-manager";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

/** Absolute base for relative metadata URLs (canonical, Open Graph); a malformed APP_URL must not break every page. */
function metadataBase(): URL {
  try {
    return new URL(siteConfig.appUrl);
  } catch {
    return new URL("http://localhost:3000");
  }
}

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getSettings();
  return {
    metadataBase: metadataBase(),
    title: { default: settings.brand.name, template: `%s · ${settings.brand.name}` },
    description: settings.brand.metaDescription,
    keywords: settings.brand.metaKeywords,
    icons: settings.brand.faviconUrl ? { icon: settings.brand.faviconUrl } : undefined,
    openGraph: settings.brand.metaImageUrl ? { images: [settings.brand.metaImageUrl] } : undefined,
  };
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const [settings, flash, consent] = await Promise.all([getSettings(), readFlash(), readConsentCookie()]);
  const dir = settings.textDirection === "auto" ? undefined : settings.textDirection;
  return (
    <html lang="en" dir={dir} className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <style>{`:root{--accent:${settings.brand.accentColor};}`}</style>
      </head>
      <body className="min-h-full flex flex-col">
        <RootSeo />
        <ToastProvider>
          {children}
          {flash && <FlashToast message={flash.message} tone={flash.tone} />}
          <PwaProvider pwa={settings.pwa} />
          <ConsentManager enabled={settings.legal.cookieBanner} initialConsent={consent} />
          <TrackingScripts ga4Id={settings.seo.ga4Id} metaPixelId={settings.seo.metaPixelId} />
        </ToastProvider>
      </body>
    </html>
  );
}
