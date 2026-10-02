"use client";

import { useState } from "react";
import type { Settings } from "@/lib/types";
import { saveVideoSettingsAction } from "@/lib/actions/video-settings";
import { VIDEO_SETTINGS_LIMITS } from "@/lib/media/video-settings";
import { Input, Switch } from "@/components/ui/input";
import { Icon } from "@/components/ui/icons";
import { SettingsRow, SettingsSection, SettingsSwitchRow } from "./settings-ui";
import { SaveBar } from "./save-bar";
import { useFormAction } from "./use-form-action";
import { useT } from "@/i18n/client";

const { watermarkOpacity: OPACITY, signedUrlMinutes: MINUTES } = VIDEO_SETTINGS_LIMITS;

/** Settings → Video: protected uploads, watermark, seek previews, autoplay next. */
export function VideoSettingsForm({ initial, sampleText }: { initial: Settings["video"]; sampleText: string }) {
  const t = useT("admin");
  const formatMinutes = (minutes: number): string => {
    if (!Number.isFinite(minutes) || minutes <= 0) return "";
    if (minutes < 60) return t("videoForm.lifetime.minutes", { minutes });
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest ? t("videoForm.lifetime.hoursMinutes", { hours, minutes: rest }) : t("videoForm.lifetime.hours", { hours });
  };
  const { onSubmit, pending, errors, dirty, markDirty, state } = useFormAction(saveVideoSettingsAction);
  const [protect, setProtect] = useState(initial.protectUploads);
  const [watermark, setWatermark] = useState(initial.watermark);
  const [opacity, setOpacity] = useState(initial.watermarkOpacity);
  const [minutes, setMinutes] = useState(String(initial.signedUrlMinutes));

  return (
    <form onSubmit={onSubmit} onChange={markDirty} noValidate className="space-y-6">
      <SettingsSection title={t("videoForm.protect.title")} description={t("videoForm.protect.description")}>
        <SettingsSwitchRow>
          <Switch
            name="protectUploads"
            checked={protect}
            onChange={(e) => setProtect(e.target.checked)}
            label={t("videoForm.protect.label")}
            description={t("videoForm.protect.help")}
          />
        </SettingsSwitchRow>
        <SettingsRow
          label={t("videoForm.lifetime.label")}
          description={t("videoForm.lifetime.description")}
          htmlFor="signedUrlMinutes"
          error={errors.signedUrlMinutes}
          required
        >
          <Input
            id="signedUrlMinutes"
            name="signedUrlMinutes"
            type="number"
            inputMode="numeric"
            min={MINUTES.min}
            max={MINUTES.max}
            step={1}
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
            invalid={!!errors.signedUrlMinutes}
            aria-describedby="signedUrlMinutes-hint"
          />
          <p id="signedUrlMinutes-hint" className="mt-1.5 text-xs text-ink-muted">
            {t("videoForm.lifetime.range", { min: MINUTES.min, max: MINUTES.max })}
            {formatMinutes(Number(minutes)) ? ` · ${formatMinutes(Number(minutes))}` : ""}
            {!protect && ` · ${t("videoForm.lifetime.whenProtected")}`}
          </p>
        </SettingsRow>
        <div className="flex items-start gap-2.5 px-4 py-3.5 text-xs leading-relaxed text-ink-muted sm:px-5">
          <Icon.Info className="mt-0.5 size-4 shrink-0 text-info" />
          <p>
            {t.rich("videoForm.protect.note", {
              secret: () => <code className="rounded bg-surface-2 px-1 font-mono text-[11px]">APP_SECRET</code>,
              env: () => <code className="rounded bg-surface-2 px-1 font-mono text-[11px]">.env</code>,
            })}
          </p>
        </div>
      </SettingsSection>

      <SettingsSection title={t("videoForm.watermark.title")} description={t("videoForm.watermark.description")}>
        <SettingsSwitchRow>
          <Switch
            name="watermark"
            checked={watermark}
            onChange={(e) => setWatermark(e.target.checked)}
            label={t("videoForm.watermark.label")}
            description={t("videoForm.watermark.help")}
          />
        </SettingsSwitchRow>
        <SettingsRow
          label={t("videoForm.opacity.label")}
          description={t("videoForm.opacity.description")}
          htmlFor="watermarkOpacity"
          error={errors.watermarkOpacity}
          stacked
        >
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_16rem] sm:items-center">
            <div>
              <div className="flex items-center gap-3">
                <input
                  id="watermarkOpacity"
                  name="watermarkOpacity"
                  type="range"
                  min={OPACITY.min}
                  max={OPACITY.max}
                  step={0.01}
                  value={opacity}
                  onChange={(e) => setOpacity(Number(e.target.value))}
                  aria-valuetext={`${Math.round(opacity * 100)}%`}
                  className="h-2 w-full cursor-pointer accent-(--accent)"
                />
                <output htmlFor="watermarkOpacity" className="w-12 shrink-0 text-right text-sm font-medium tabular-nums text-ink">
                  {Math.round(opacity * 100)}%
                </output>
              </div>
              <p className="mt-1.5 text-xs text-ink-muted">
                {t("videoForm.opacity.range", { min: Math.round(OPACITY.min * 100), max: Math.round(OPACITY.max * 100) })}
              </p>
            </div>
            <div
              className="relative aspect-video overflow-hidden rounded-lg bg-linear-to-br from-slate-700 via-slate-800 to-slate-950 ring-1 ring-border"
              aria-label={t("videoForm.opacity.preview")}
              role="img"
            >
              <span className="absolute inset-0 flex items-center justify-center">
                <span className="flex size-10 items-center justify-center rounded-full bg-white/15 text-white">
                  <Icon.Play className="ml-0.5 size-5" />
                </span>
              </span>
              <span
                className="absolute left-[58%] top-[24%] -translate-x-1/2 truncate font-mono text-[11px] font-medium text-white"
                style={{ opacity: watermark ? opacity : 0, textShadow: "0 1px 2px rgb(0 0 0 / 0.85)" }}
              >
                {sampleText}
              </span>
              {!watermark && <span className="absolute inset-x-0 bottom-2 text-center text-[11px] text-white/60">{t("videoForm.opacity.off")}</span>}
            </div>
          </div>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title={t("videoForm.player.title")}>
        <SettingsSwitchRow>
          <Switch
            name="seekThumbnails"
            defaultChecked={initial.seekThumbnails}
            label={t("videoForm.player.seekLabel")}
            description={t("videoForm.player.seekDescription")}
          />
        </SettingsSwitchRow>
        <SettingsSwitchRow>
          <Switch
            name="autoplayNext"
            defaultChecked={initial.autoplayNext}
            label={t("videoForm.player.autoplayLabel")}
            description={t("videoForm.player.autoplayDescription")}
          />
        </SettingsSwitchRow>
      </SettingsSection>

      <SaveBar dirty={dirty} pending={pending} saved={state?.ok} failed={state?.ok === false} />
    </form>
  );
}
