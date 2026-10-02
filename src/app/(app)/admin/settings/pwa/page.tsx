import type { ReactNode } from "react";
import { requireRole } from "@/lib/auth/session";
import { getSettings } from "@/lib/db/store";
import { getPublicBaseUrl } from "@/lib/data/certificates";
import { ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { SettingsPanelHeader, SettingsSection } from "@/components/admin/settings/settings-ui";
import { PwaSettingsForm } from "@/components/admin/settings/pwa-settings-form";
import { PwaDiagnostics } from "@/components/pwa/pwa-diagnostics";
import { cn } from "@/lib/utils";
import type { Metadata } from "next";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("admin");
  return { title: t("pages.settings.pwa.metaTitle") };
}

type CheckState = "ok" | "warn" | "info";

function isSecureOrigin(baseUrl: string): boolean {
  try {
    const { protocol, hostname } = new URL(baseUrl);
    return protocol === "https:" || hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
  } catch {
    return false;
  }
}

function Check({ state, title, children }: { state: CheckState; title: string; children: ReactNode }) {
  const icon =
    state === "ok" ? (
      <Icon.CheckCircle className="size-5 text-success" />
    ) : state === "warn" ? (
      <Icon.AlertTriangle className="size-5 text-warning" />
    ) : (
      <Icon.Info className="size-5 text-info" />
    );
  return (
    <li className="flex items-start gap-3 px-4 py-3.5 sm:px-5">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0">
        <p className="text-sm font-medium text-ink">{title}</p>
        <div className="mt-0.5 text-xs leading-relaxed text-ink-muted">{children}</div>
      </div>
    </li>
  );
}

export default async function PwaSettingsPage() {
  const t = await getT("admin");
  await requireRole(["admin"], "/admin/settings/pwa");
  const [settings, baseUrl] = await Promise.all([getSettings(), getPublicBaseUrl()]);
  const { pwa, brand } = settings;
  const secure = isSecureOrigin(baseUrl);
  const production = process.env.NODE_ENV === "production";

  return (
    <>
      <SettingsPanelHeader
        title={t("pages.settings.pwa.title")}
        description={t("pages.settings.pwa.description")}
        actions={
          <ButtonLink href="/offline" target="_blank" variant="outline" size="sm" leftIcon={<Icon.ExternalLink className="size-4" />}>
            {t("pages.settings.pwa.previewOffline")}
          </ButtonLink>
        }
      />
      <PwaSettingsForm initial={pwa} />

      <div className="mt-6 space-y-6">
        <SettingsSection title={t("pages.settings.pwa.readiness.title")} description={t("pages.settings.pwa.readiness.description")}>
          <ul className="divide-y divide-border">
            <Check state={secure ? "ok" : "warn"} title={secure ? t("pages.settings.pwa.readiness.secure") : t("pages.settings.pwa.readiness.httpsRequired")}>
              {secure ? (
                t.rich("pages.settings.pwa.readiness.secureDetail", {
                  host: (
                    <span dir="ltr" className="font-mono text-ink">
                      {new URL(baseUrl).host}
                    </span>
                  ),
                })
              ) : (
                t.rich("pages.settings.pwa.readiness.httpsDetail", { code: (chunks) => <span className="font-mono">{chunks}</span> })
              )}
            </Check>
            <Check state={production ? "ok" : "info"} title={production ? t("pages.settings.pwa.readiness.production") : t("pages.settings.pwa.readiness.development")}>
              {production
                ? t("pages.settings.pwa.readiness.productionDetail")
                : t("pages.settings.pwa.readiness.developmentDetail")}
            </Check>
            <Check state={pwa.enabled ? "ok" : "info"} title={t("pages.settings.pwa.readiness.manifest")}>
              <a href="/manifest.webmanifest" target="_blank" rel="noopener noreferrer" className="font-medium text-accent hover:underline">
                /manifest.webmanifest
              </a>{" "}
              {pwa.enabled ? t("pages.settings.pwa.readiness.manifestOn") : t("pages.settings.pwa.readiness.manifestOff")}
            </Check>
            <Check state="ok" title={t("pages.settings.pwa.readiness.icons")}>
              <div className="mt-1.5 flex items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element -- static public SVG icons */}
                <img src="/images/icon-192.svg" alt={t("pages.settings.pwa.readiness.standardIcon")} className="size-10 rounded-lg" />
                {/* eslint-disable-next-line @next/next/no-img-element -- static public SVG icons */}
                <img src="/images/icon-maskable.svg" alt={t("pages.settings.pwa.readiness.maskableIcon")} className="size-10 rounded-full" />
                <span>{t("pages.settings.pwa.readiness.iconsDetail")}</span>
              </div>
            </Check>
            <Check state="ok" title={t("pages.settings.pwa.readiness.theme")}>
              <span className="inline-flex items-center gap-2">
                <span className="size-4 rounded border border-border" style={{ backgroundColor: brand.accentColor }} aria-hidden="true" />
                {t.rich("pages.settings.pwa.readiness.themeDetail", {
                  color: (
                    <span dir="ltr" className="font-mono text-ink">
                      {brand.accentColor}
                    </span>
                  ),
                })}
              </span>
            </Check>
          </ul>
        </SettingsSection>

        <SettingsSection title={t("pages.settings.pwa.browser.title")} description={t("pages.settings.pwa.browser.description")}>
          <PwaDiagnostics enabled={pwa.enabled} />
        </SettingsSection>

        <SettingsSection title={t("pages.settings.pwa.storage.title")}>
          <ul className={cn("space-y-2 px-4 py-4 text-sm text-ink-muted sm:px-5", "list-disc ps-9 sm:ps-10")}>
            <li>{t("pages.settings.pwa.storage.files")}</li>
            <li>{t("pages.settings.pwa.storage.offline")}</li>
            <li>{t("pages.settings.pwa.storage.public")}</li>
            <li>{t("pages.settings.pwa.storage.never")}</li>
          </ul>
        </SettingsSection>
      </div>
    </>
  );
}
