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

export const metadata = { title: "Installable app settings" };

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
  await requireRole(["admin"], "/admin/settings/pwa");
  const [settings, baseUrl] = await Promise.all([getSettings(), getPublicBaseUrl()]);
  const { pwa, brand } = settings;
  const secure = isSecureOrigin(baseUrl);
  const production = process.env.NODE_ENV === "production";

  return (
    <>
      <SettingsPanelHeader
        title="Installable app"
        description="Let members install the platform like an app and keep a helpful screen on hand when their connection drops."
        actions={
          <ButtonLink href="/offline" target="_blank" variant="outline" size="sm" leftIcon={<Icon.ExternalLink className="size-4" />}>
            Preview offline page
          </ButtonLink>
        }
      />
      <PwaSettingsForm initial={pwa} />

      <div className="mt-6 space-y-6">
        <SettingsSection title="Readiness" description="What browsers need before they offer to install the app.">
          <ul className="divide-y divide-border">
            <Check state={secure ? "ok" : "warn"} title={secure ? "Served securely" : "HTTPS required"}>
              {secure ? (
                <>
                  Service workers run on <span className="font-mono text-ink">{new URL(baseUrl).host}</span>.
                </>
              ) : (
                <>
                  Browsers only allow service workers on HTTPS (or localhost). Serve the site over HTTPS and set <span className="font-mono">APP_URL</span>{" "}
                  to its https address.
                </>
              )}
            </Check>
            <Check state={production ? "ok" : "info"} title={production ? "Production build" : "Development build"}>
              {production
                ? "The service worker registers automatically for every visitor while the app is turned on."
                : "The service worker only registers in production builds (next build, then next start), so development changes are never cached."}
            </Check>
            <Check state={pwa.enabled ? "ok" : "info"} title="Web app manifest">
              <a href="/manifest.webmanifest" target="_blank" rel="noopener noreferrer" className="font-medium text-accent hover:underline">
                /manifest.webmanifest
              </a>{" "}
              {pwa.enabled ? "tells browsers the app's name, colors and icons." : "is served in browser mode while the app is off, so browsers don't offer installation."}
            </Check>
            <Check state="ok" title="App icons">
              <div className="mt-1.5 flex items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element -- static public SVG icons */}
                <img src="/images/icon-192.svg" alt="Standard app icon" className="size-10 rounded-lg" />
                {/* eslint-disable-next-line @next/next/no-img-element -- static public SVG icons */}
                <img src="/images/icon-maskable.svg" alt="Maskable app icon" className="size-10 rounded-full" />
                <span>Standard and maskable (adaptive) icons in 192 and 512 px.</span>
              </div>
            </Check>
            <Check state="ok" title="Theme color">
              <span className="inline-flex items-center gap-2">
                <span className="size-4 rounded border border-border" style={{ backgroundColor: brand.accentColor }} aria-hidden="true" />
                Uses your brand accent <span className="font-mono text-ink">{brand.accentColor}</span> for the title bar and splash screen.
              </span>
            </Check>
          </ul>
        </SettingsSection>

        <SettingsSection title="This browser" description="Check the service worker in the browser you're using right now.">
          <PwaDiagnostics enabled={pwa.enabled} />
        </SettingsSection>

        <SettingsSection title="What gets stored on devices">
          <ul className={cn("space-y-2 px-4 py-4 text-sm text-ink-muted sm:px-5", "list-disc pl-9 sm:pl-10")}>
            <li>App files (scripts, styles, fonts) and recently seen images, so repeat visits load faster.</li>
            <li>The offline page, downloaded without any member data.</li>
            <li>Public pages visited while signed out, for reading offline. Pages rendered for signed-in members are never stored.</li>
            <li>Never stored: API responses, form submissions, lesson videos and anything from admin or account pages.</li>
          </ul>
        </SettingsSection>
      </div>
    </>
  );
}
