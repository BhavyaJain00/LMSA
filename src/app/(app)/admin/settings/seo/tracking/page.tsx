import Link from "next/link";
import { requireRole } from "@/lib/auth/session";
import { getSettings } from "@/lib/db/store";
import { SettingsSection } from "@/components/admin/settings/settings-ui";
import { TrackingForm } from "@/components/seo/admin/tracking-form";
import { Icon } from "@/components/ui/icons";

export const metadata = { title: "Tracking · SEO settings" };

const EVENTS: { name: string; when: string; meta: string }[] = [
  { name: "page_view", when: "Every page, including navigation inside the app", meta: "PageView" },
  { name: "generate_lead", when: "A visitor subscribes through a lead form", meta: "Lead" },
  { name: "sign_up", when: "A lead confirms their email address", meta: "CompleteRegistration" },
  { name: "purchase", when: "A paid order succeeds (once per order, with value, currency and coupon)", meta: "Purchase" },
];

/** Consent-gated measurement tags: GA4 and Meta Pixel IDs, how consent applies and which events are sent. */
export default async function SeoTrackingPage() {
  await requireRole(["admin"], "/admin/settings/seo/tracking");
  const settings = await getSettings();
  const bannerOn = settings.legal.cookieBanner;

  return (
    <div className="space-y-6">
      {!bannerOn && (settings.seo.ga4Id || settings.seo.metaPixelId) && (
        <div role="alert" className="flex items-start gap-3 rounded-card border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-ink">
          <Icon.AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
          <p>
            <span className="font-medium">The cookie banner is off, so visitors can&apos;t give consent and no tag loads.</span>{" "}
            <Link href="/admin/settings/legal" className="font-medium text-accent hover:underline">
              Turn on the cookie banner
            </Link>{" "}
            <span className="text-ink-muted">(visitors can still accept from “Cookie settings” in the footer).</span>
          </p>
        </div>
      )}

      <TrackingForm initial={{ ga4Id: settings.seo.ga4Id ?? "", metaPixelId: settings.seo.metaPixelId ?? "" }} />

      <SettingsSection title="How consent works" description="Tags never load before the visitor agrees.">
        <ul className="space-y-2 px-4 py-4 text-sm text-ink-muted sm:px-5">
          <li className="flex gap-2">
            <Icon.ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
            Google Analytics loads only after a visitor accepts <span className="font-medium text-ink">analytics</span> cookies; the Meta Pixel only after they accept{" "}
            <span className="font-medium text-ink">marketing</span> cookies.
          </li>
          <li className="flex gap-2">
            <Icon.ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
            Withdrawing consent stops both tags at once, in every open tab, and deletes their cookies.
          </li>
          <li className="flex gap-2">
            <Icon.ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
            Sign-in tokens, signed links and email addresses are removed from page addresses before they are reported.
          </li>
        </ul>
      </SettingsSection>

      <SettingsSection title="Events sent" description="Use these as conversions in Google Analytics and Meta Ads Manager.">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[32rem] text-left text-sm">
            <thead className="text-xs text-ink-muted">
              <tr className="border-b border-border">
                <th scope="col" className="px-4 py-2 font-medium sm:px-5">
                  Google Analytics
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  Meta Pixel
                </th>
                <th scope="col" className="px-4 py-2 font-medium sm:px-5">
                  When
                </th>
              </tr>
            </thead>
            <tbody>
              {EVENTS.map((e) => (
                <tr key={e.name} className="border-b border-border last:border-b-0">
                  <td className="px-4 py-2.5 font-mono text-xs text-ink sm:px-5">{e.name}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-ink">{e.meta}</td>
                  <td className="px-4 py-2.5 text-ink-muted sm:px-5">{e.when}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SettingsSection>
    </div>
  );
}
