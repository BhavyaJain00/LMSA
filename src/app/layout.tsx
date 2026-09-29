import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { getSettings } from "@/lib/db/store";
import { readFlash } from "@/lib/flash";
import { FlashToast, ToastProvider } from "@/components/ui/toast";
import { themeInitScript } from "@/components/ui/theme-toggle";
import { PwaProvider } from "@/components/pwa/pwa-provider";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getSettings();
  return {
    title: { default: settings.brand.name, template: `%s · ${settings.brand.name}` },
    description: settings.brand.metaDescription,
    keywords: settings.brand.metaKeywords,
    icons: settings.brand.faviconUrl ? { icon: settings.brand.faviconUrl } : undefined,
    openGraph: settings.brand.metaImageUrl ? { images: [settings.brand.metaImageUrl] } : undefined,
  };
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const [settings, flash] = await Promise.all([getSettings(), readFlash()]);
  const dir = settings.textDirection === "auto" ? undefined : settings.textDirection;
  return (
    <html lang="en" dir={dir} className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <style>{`:root{--accent:${settings.brand.accentColor};}`}</style>
      </head>
      <body className="min-h-full flex flex-col">
        <ToastProvider>
          {children}
          {flash && <FlashToast message={flash.message} tone={flash.tone} />}
          <PwaProvider pwa={settings.pwa} />
        </ToastProvider>
      </body>
    </html>
  );
}
