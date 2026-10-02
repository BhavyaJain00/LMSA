import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { getSettings } from "@/lib/db/store";
import { readFlash } from "@/lib/flash";
import { rootMetadata } from "@/lib/seo/metadata";
import { readConsentCookie } from "@/lib/legal/consent";
import { FlashToast, ToastProvider } from "@/components/ui/toast";
import { themeInitScript } from "@/components/ui/theme-toggle";
import { PwaProvider } from "@/components/pwa/pwa-provider";
import { RootSeo } from "@/components/seo/root-seo";
import { TrackingScripts } from "@/components/seo/tracking-scripts";
import { ConsentManager } from "@/components/legal/consent-manager";
import { NAMESPACES, documentDir } from "@/i18n/config";
import { getLocale } from "@/i18n/server";
import { I18nProvider } from "@/i18n/provider";
import { globalSlices } from "@/i18n/provided";

/** Provided in full on every page; every other namespace contributes only its `global.` keys. */
const ROOT_PICK = globalSlices(["common", "shell"]);

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

/** Site-wide metadata: title template, verification tags, RSS alternates, og:locale, noindex-by-default robots (see `rootMetadata`). */
export async function generateMetadata(): Promise<Metadata> {
  const [settings, locale] = await Promise.all([getSettings(), getLocale()]);
  return rootMetadata(settings, undefined, locale);
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const [settings, flash, consent, locale] = await Promise.all([getSettings(), readFlash(), readConsentCookie(), getLocale()]);
  // The interface language sets lang/dir; an explicit admin text direction (Settings → General) overrides dir.
  const dir = documentDir(locale, settings.textDirection);
  return (
    <html lang={locale} dir={dir} className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <style>{`:root{--accent:${settings.brand.accentColor};}`}</style>
      </head>
      <body className="min-h-full flex flex-col">
        <RootSeo />
        {/*
          Shared words and the app shell are needed on every page (the lesson player reuses the account menu).
          The `global.` keys of the other namespaces serve client components mounted here or reused across
          sections (PWA prompts, the cookie banner, the command palette, the footer sign-up form).
        */}
        <I18nProvider namespaces={NAMESPACES} pick={ROOT_PICK}>
          <ToastProvider>
            {children}
            {flash && <FlashToast message={flash.message} tone={flash.tone} />}
            <PwaProvider pwa={settings.pwa} />
            <ConsentManager enabled={settings.legal.cookieBanner} initialConsent={consent} />
            <TrackingScripts ga4Id={settings.seo.ga4Id} metaPixelId={settings.seo.metaPixelId} />
          </ToastProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
