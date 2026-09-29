"use client";

import { useState, type CSSProperties } from "react";
import { saveBrandingSettingsAction } from "@/lib/actions/settings";
import { FileUpload } from "@/components/ui/file-upload";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icons";
import { cn, initials } from "@/lib/utils";
import { SettingsRow, SettingsSection } from "./settings-ui";
import { SaveBar } from "./save-bar";
import { useFormAction } from "./use-form-action";

/** Suggested accent colors (data values offered to the admin, not UI styling). */
const PRESETS = [
  { name: "Indigo", value: "#4f46e5" },
  { name: "Blue", value: "#2563eb" },
  { name: "Violet", value: "#7c3aed" },
  { name: "Emerald", value: "#059669" },
  { name: "Teal", value: "#0d9488" },
  { name: "Rose", value: "#e11d48" },
  { name: "Orange", value: "#ea580c" },
  { name: "Slate", value: "#334155" },
];

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

function expandHex(hex: string): string | null {
  if (!HEX_RE.test(hex)) return null;
  const h = hex.slice(1);
  return `#${h.length === 3 ? h.split("").map((c) => c + c).join("") : h}`.toLowerCase();
}

function luminance(hex: string): number {
  const h = hex.slice(1);
  const channel = (i: number) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

/** WCAG contrast ratio between two colors. */
function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export interface BrandingValues {
  brandName: string;
  logoUrl: string;
  faviconUrl: string;
  accentColor: string;
}

export function BrandingForm({ initial }: { initial: BrandingValues }) {
  const { onSubmit, pending, errors, dirty, markDirty, state } = useFormAction(saveBrandingSettingsAction);
  const [logoUrl, setLogoUrl] = useState(initial.logoUrl);
  const [faviconUrl, setFaviconUrl] = useState(initial.faviconUrl);
  const [accent, setAccent] = useState(initial.accentColor);

  const valid = expandHex(accent);
  const ratio = valid ? contrast(valid, "#ffffff") : null;
  const previewStyle = valid ? ({ "--accent": valid } as CSSProperties) : undefined;

  const changeAccent = (value: string) => {
    setAccent(value);
    markDirty();
  };

  return (
    <form onSubmit={onSubmit} onChange={markDirty} noValidate className="space-y-6">
      <SettingsSection title="Logo & favicon" description="Uploaded images are served from your own server.">
        <SettingsRow
          label="Brand logo"
          description="Appears in the left sidebar next to the brand name. Recommended size is 32x32 px in PNG or SVG."
          error={errors.logoUrl}
          stacked
        >
          <FileUpload
            name="logoUrl"
            kind="image"
            value={logoUrl}
            onChange={(url) => {
              setLogoUrl(url);
              markDirty();
            }}
            hint="PNG, SVG, JPG or WebP up to 25 MB."
          />
        </SettingsRow>
        <SettingsRow
          label="Favicon"
          description="Appears next to the title in your browser tab. Recommended size is 32x32 px in PNG or ICO."
          error={errors.faviconUrl}
          stacked
        >
          <FileUpload
            name="faviconUrl"
            kind="image"
            value={faviconUrl}
            onChange={(url) => {
              setFaviconUrl(url);
              markDirty();
            }}
          />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="Accent color" description="Used for primary buttons, links, focus rings and highlights in both light and dark mode.">
        <SettingsRow label="Accent color" description="Pick a color or enter a hex value." htmlFor="accentColor" error={errors.accentColor}>
          <div className="flex items-center gap-2">
            <input
              type="color"
              aria-label="Pick accent color"
              value={valid ?? "#000000"}
              onChange={(e) => changeAccent(e.target.value)}
              className="size-9.5 shrink-0 cursor-pointer rounded-lg border border-border-strong bg-surface-1 p-1"
            />
            <Input
              id="accentColor"
              name="accentColor"
              value={accent}
              onChange={(e) => changeAccent(e.target.value.trim())}
              placeholder="#4f46e5"
              maxLength={7}
              spellCheck={false}
              className="font-mono uppercase"
              invalid={!valid || !!errors.accentColor}
            />
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Suggested colors">
            {PRESETS.map((p) => (
              <button
                key={p.value}
                type="button"
                title={p.name}
                aria-label={`Use ${p.name}`}
                aria-pressed={valid === p.value}
                onClick={() => changeAccent(p.value)}
                className={cn("size-6 rounded-full ring-offset-2 ring-offset-surface-1 transition-transform hover:scale-110", valid === p.value && "ring-2 ring-ink")}
                style={{ background: p.value }}
              />
            ))}
          </div>
        </SettingsRow>

        <div className="px-4 py-4 sm:px-5" style={previewStyle}>
          <p className="mb-3 text-sm font-medium text-ink">Live preview</p>
          <div className="grid gap-4 md:grid-cols-[14rem_minmax(0,1fr)]">
            <div className="rounded-xl border border-border bg-surface-1 p-3">
              <div className="flex items-center gap-2">
                {logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={logoUrl} alt="" className="size-7 rounded-md object-contain" />
                ) : (
                  <span className="flex size-7 items-center justify-center rounded-md bg-accent text-xs font-bold text-accent-fg">{initials(initial.brandName)}</span>
                )}
                <span className="truncate text-sm font-semibold text-ink">{initial.brandName}</span>
              </div>
              <div className="mt-3 space-y-1 text-sm">
                <span className="flex items-center gap-2 rounded-lg bg-accent/10 px-2 py-1.5 font-medium text-accent">
                  <Icon.BookOpen className="size-4" /> Courses
                </span>
                <span className="flex items-center gap-2 px-2 py-1.5 text-ink-muted">
                  <Icon.Users className="size-4" /> Batches
                </span>
              </div>
            </div>
            <div className="rounded-xl border border-border bg-surface-1 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex h-9 items-center rounded-lg bg-accent px-4 text-sm font-medium text-accent-fg">Enroll now</span>
                <span className="inline-flex h-9 items-center rounded-lg border border-accent px-4 text-sm font-medium text-accent">Preview</span>
                <Badge tone="accent">Featured</Badge>
              </div>
              <p className="mt-3 text-sm text-ink-muted">
                Links look <span className="font-medium text-accent underline underline-offset-4">like this</span> and progress bars fill with your accent.
              </p>
              <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-surface-3">
                <div className="h-full w-2/3 rounded-full bg-accent" />
              </div>
            </div>
          </div>
          {ratio !== null && (
            <p className={cn("mt-3 flex items-start gap-1.5 text-xs", ratio >= 4.5 ? "text-success" : ratio >= 3 ? "text-warning" : "text-danger")}>
              {ratio >= 4.5 ? <Icon.CheckCircle className="mt-px size-4 shrink-0" /> : <Icon.AlertTriangle className="mt-px size-4 shrink-0" />}
              <span>
                Contrast with button text: {ratio.toFixed(1)}:1 —{" "}
                {ratio >= 4.5
                  ? "passes WCAG AA for normal text."
                  : ratio >= 3
                    ? "passes only for large text. Consider a darker shade so button labels stay readable."
                    : "too low. Button labels will be hard to read — pick a darker color."}
              </span>
            </p>
          )}
        </div>
      </SettingsSection>

      <SaveBar dirty={dirty} pending={pending} saved={state?.ok} failed={state?.ok === false} />
    </form>
  );
}
