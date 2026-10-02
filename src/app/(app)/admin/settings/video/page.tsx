import { requireRole } from "@/lib/auth/session";
import { getDb } from "@/lib/db/store";
import { parseMediaSrc } from "@/lib/media/paths";
import { siteOrigins } from "@/lib/media/access";
import { StatCard } from "@/components/ui/card";
import { Icon } from "@/components/ui/icons";
import { SettingsPanelHeader } from "@/components/admin/settings/settings-ui";
import { VideoSettingsForm } from "@/components/admin/settings/video-settings-form";
import { getFormatter } from "@/i18n/server";
import type { Metadata } from "next";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("admin");
  return { title: t("pages.settings.video.metaTitle") };
}

type VideoKind = "protected" | "legacy" | "external";

function classify(src: string, origins: string[]): VideoKind {
  const parsed = parseMediaSrc(src, origins);
  if (parsed?.isProtectedVideo) return "protected";
  if (parsed?.isUpload) return "legacy";
  return "external";
}

export default async function VideoSettingsPage() {
  const t = await getT("admin");
  const admin = await requireRole(["admin"], "/admin/settings/video");
  const [db, f] = await Promise.all([getDb(), getFormatter()]);
  const formatNumber = (n: number) => f.number(n);
  const settings = db.settings.video;
  const origins = siteOrigins();

  // Where lesson, promo and recording videos come from, so admins see what protection covers.
  const counts: Record<VideoKind, number> = { protected: 0, legacy: 0, external: 0 };
  for (const lesson of db.lessons) {
    for (const block of lesson.blocks) {
      if (block.type !== "video") continue;
      for (const src of [block.src, ...(block.sources ?? []).map((s) => s.src)]) if (src) counts[classify(src, origins)]++;
    }
  }
  for (const course of db.courses) if (course.videoUrl) counts[classify(course.videoUrl, origins)]++;
  for (const liveClass of db.liveClasses) if (liveClass.recordingUrl) counts[classify(liveClass.recordingUrl, origins)]++;
  const secretFromEnv = !!process.env.APP_SECRET?.trim();
  const tracked = db.videoWatches.filter((w) => w.bins?.some((v) => v > 0)).length;

  return (
    <>
      <SettingsPanelHeader title={t("pages.settings.video.title")} description={t("pages.settings.video.description")} />

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <StatCard
          label={t("pages.settings.video.stats.protectable")}
          value={formatNumber(counts.protected)}
          icon={<Icon.ShieldCheck className="size-4" />}
          hint={settings.protectUploads ? t("pages.settings.video.stats.protectedHint") : t("pages.settings.video.stats.protectionOff")}
        />
        <StatCard label={t("pages.settings.video.stats.legacy")} value={formatNumber(counts.legacy)} icon={<Icon.Video className="size-4" />} hint={t("pages.settings.video.stats.legacyHint")} />
        <StatCard label={t("pages.settings.video.stats.external")} value={formatNumber(counts.external)} icon={<Icon.Globe className="size-4" />} hint={t("pages.settings.video.stats.externalHint")} />
      </div>

      {settings.protectUploads && !secretFromEnv && (
        <div role="status" className="mb-6 flex items-start gap-2.5 rounded-card border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-ink">
          <Icon.AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
          <p>
            {t.rich("pages.settings.video.noSecret", {
              b: (chunks) => <span className="font-medium">{chunks}</span>,
              code: (chunks) => (
                <code dir="ltr" className="rounded bg-surface-2 px-1 font-mono text-xs">
                  {chunks}
                </code>
              ),
            })}
          </p>
        </div>
      )}

      <VideoSettingsForm initial={settings} sampleText={admin.email || admin.name} />

      <p className="mt-4 text-xs text-ink-muted">
        {t("pages.settings.video.retention", { count: tracked })}
      </p>
    </>
  );
}
