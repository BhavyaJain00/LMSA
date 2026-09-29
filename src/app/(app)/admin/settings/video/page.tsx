import { requireRole } from "@/lib/auth/session";
import { getDb } from "@/lib/db/store";
import { parseMediaSrc } from "@/lib/media/paths";
import { siteOrigins } from "@/lib/media/access";
import { StatCard } from "@/components/ui/card";
import { Icon } from "@/components/ui/icons";
import { SettingsPanelHeader } from "@/components/admin/settings/settings-ui";
import { VideoSettingsForm } from "@/components/admin/settings/video-settings-form";
import { formatNumber } from "@/lib/utils";

export const metadata = { title: "Video settings" };

type VideoKind = "protected" | "legacy" | "external";

function classify(src: string, origins: string[]): VideoKind {
  const parsed = parseMediaSrc(src, origins);
  if (parsed?.isProtectedVideo) return "protected";
  if (parsed?.isUpload) return "legacy";
  return "external";
}

export default async function VideoSettingsPage() {
  const admin = await requireRole(["admin"], "/admin/settings/video");
  const db = await getDb();
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
      <SettingsPanelHeader title="Video" description="Protect uploaded lesson videos, add a viewer watermark and tune the video player for everyone." />

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <StatCard
          label="Protectable videos"
          value={formatNumber(counts.protected)}
          icon={<Icon.ShieldCheck className="size-4" />}
          hint={settings.protectUploads ? "Uploads served with signed links" : "Protection is off"}
        />
        <StatCard label="Older uploads" value={formatNumber(counts.legacy)} icon={<Icon.Video className="size-4" />} hint="Uploaded before protection; public links keep working" />
        <StatCard label="External links" value={formatNumber(counts.external)} icon={<Icon.Globe className="size-4" />} hint="Hosted elsewhere; not affected" />
      </div>

      {settings.protectUploads && !secretFromEnv && (
        <div role="status" className="mb-6 flex items-start gap-2.5 rounded-card border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-ink">
          <Icon.AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
          <p>
            <span className="font-medium">APP_SECRET is not set.</span> Video links are signed with a key generated for this development machine. Set a long random{" "}
            <code className="rounded bg-surface-2 px-1 font-mono text-xs">APP_SECRET</code> in <code className="rounded bg-surface-2 px-1 font-mono text-xs">.env</code> before going to production (the
            app refuses to start without it there).
          </p>
        </div>
      )}

      <VideoSettingsForm initial={settings} sampleText={admin.email || admin.name} />

      <p className="mt-4 text-xs text-ink-muted">
        Retention analytics are recorded for every lesson video automatically ({formatNumber(tracked)} {tracked === 1 ? "learner view has" : "learner views have"} detailed data so far). Open a course and
        choose Video analytics to see them.
      </p>
    </>
  );
}
