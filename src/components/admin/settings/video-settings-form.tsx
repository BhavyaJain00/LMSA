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

const { watermarkOpacity: OPACITY, signedUrlMinutes: MINUTES } = VIDEO_SETTINGS_LIMITS;

function formatMinutes(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return "";
  if (minutes < 60) return `${minutes} minutes`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h} ${h === 1 ? "hour" : "hours"}${m ? ` ${m} min` : ""}`;
}

/** Settings → Video: protected uploads, watermark, seek previews, autoplay next. */
export function VideoSettingsForm({ initial, sampleText }: { initial: Settings["video"]; sampleText: string }) {
  const { onSubmit, pending, errors, dirty, markDirty, state } = useFormAction(saveVideoSettingsAction);
  const [protect, setProtect] = useState(initial.protectUploads);
  const [watermark, setWatermark] = useState(initial.watermark);
  const [opacity, setOpacity] = useState(initial.watermarkOpacity);
  const [minutes, setMinutes] = useState(String(initial.signedUrlMinutes));

  return (
    <form onSubmit={onSubmit} onChange={markDirty} noValidate className="space-y-6">
      <SettingsSection title="Protected uploads" description="Keep uploaded lesson videos from being shared or downloaded with a plain link.">
        <SettingsSwitchRow>
          <Switch
            name="protectUploads"
            checked={protect}
            onChange={(e) => setProtect(e.target.checked)}
            label="Protect uploaded videos"
            description="Videos uploaded to this site play only through signed links that expire and work for one signed-in account. A copied link does not play for anyone else. Links to videos hosted elsewhere are not affected."
          />
        </SettingsSwitchRow>
        <SettingsRow
          label="Signed link lifetime (minutes)"
          description="How long a video link stays valid. The player renews it automatically before it expires, so learners are never interrupted."
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
            {MINUTES.min}–{MINUTES.max} minutes{formatMinutes(Number(minutes)) ? ` · ${formatMinutes(Number(minutes))}` : ""}
            {!protect && " · applies when protection is on"}
          </p>
        </SettingsRow>
        <div className="flex items-start gap-2.5 px-4 py-3.5 text-xs leading-relaxed text-ink-muted sm:px-5">
          <Icon.Info className="mt-0.5 size-4 shrink-0 text-info" />
          <p>
            New uploads are stored in a private videos folder. Videos uploaded before this feature existed keep working with their current links. Signing requires a
            long random <code className="rounded bg-surface-2 px-1 font-mono text-[11px]">APP_SECRET</code> in your <code className="rounded bg-surface-2 px-1 font-mono text-[11px]">.env</code> file in
            production.
          </p>
        </div>
      </SettingsSection>

      <SettingsSection title="Watermark" description="Discourage screen recording by showing who is watching.">
        <SettingsSwitchRow>
          <Switch
            name="watermark"
            checked={watermark}
            onChange={(e) => setWatermark(e.target.checked)}
            label="Show a viewer watermark"
            description="Overlays the signed-in learner's email on lesson videos and moves it to a new spot every few seconds, also in fullscreen. Visitors who are not signed in see no watermark. Picture-in-picture is turned off while the watermark is shown."
          />
        </SettingsSwitchRow>
        <SettingsRow
          label="Watermark opacity"
          description="Lower values are less distracting; higher values are harder to crop out of recordings."
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
                {Math.round(OPACITY.min * 100)}% to {Math.round(OPACITY.max * 100)}%
              </p>
            </div>
            <div
              className="relative aspect-video overflow-hidden rounded-lg bg-linear-to-br from-slate-700 via-slate-800 to-slate-950 ring-1 ring-border"
              aria-label="Watermark preview"
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
              {!watermark && <span className="absolute inset-x-0 bottom-2 text-center text-[11px] text-white/60">Watermark is off</span>}
            </div>
          </div>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="Player">
        <SettingsSwitchRow>
          <Switch
            name="seekThumbnails"
            defaultChecked={initial.seekThumbnails}
            label="Seek-bar previews"
            description="Show a preview frame when hovering the timeline. Frames are generated in the learner's browser; videos hosted on other sites without cross-origin access show the time only."
          />
        </SettingsSwitchRow>
        <SettingsSwitchRow>
          <Switch
            name="autoplayNext"
            defaultChecked={initial.autoplayNext}
            label="Autoplay the next lesson"
            description="When the last video of a lesson ends, count down five seconds and open the next lesson. Learners can cancel the countdown."
          />
        </SettingsSwitchRow>
      </SettingsSection>

      <SaveBar dirty={dirty} pending={pending} saved={state?.ok} failed={state?.ok === false} />
    </form>
  );
}
