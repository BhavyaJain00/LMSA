import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { siteConfig } from "@/lib/config";
import { Markdown } from "@/lib/markdown";
import { cn, formatBytes } from "@/lib/utils";
import { AudioPlayer } from "@/components/player";
import { buttonClasses } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { getFormatter, getT } from "@/i18n/server";

/** Width wrapper shared by every lesson block (follows the zen/normal width variable). */
export function BlockFrame({ children, className, interactive }: { children: ReactNode; className?: string; interactive?: boolean }) {
  return (
    <div className={cn("mx-auto w-full max-w-(--lesson-w)", className)} data-no-highlight={interactive ? "" : undefined}>
      {children}
    </div>
  );
}

export function MarkdownBlock({ content }: { content: string }) {
  if (!content.trim()) return null;
  return (
    <BlockFrame>
      <Markdown content={content} />
    </BlockFrame>
  );
}

const CALLOUTS = {
  info: { icon: Icon.Info, label: "learn.callout.info", box: "border-info/30 bg-info/8", fg: "text-info" },
  success: { icon: Icon.CheckCircle, label: "learn.callout.success", box: "border-success/30 bg-success/8", fg: "text-success" },
  warning: { icon: Icon.AlertTriangle, label: "learn.callout.warning", box: "border-warning/35 bg-warning/10", fg: "text-warning" },
  danger: { icon: Icon.AlertCircle, label: "learn.callout.danger", box: "border-danger/30 bg-danger/8", fg: "text-danger" },
} as const;

export async function CalloutBlock({ tone, content }: { tone: keyof typeof CALLOUTS; content: string }) {
  const t = await getT("learning");
  const style = CALLOUTS[tone] ?? CALLOUTS.info;
  const label = t(style.label);
  const IconCmp = style.icon;
  return (
    <BlockFrame>
      <aside role="note" aria-label={label} className={cn("flex gap-3 rounded-xl border p-4", style.box)}>
        <IconCmp className={cn("mt-0.5 size-5 shrink-0", style.fg)} />
        <div className="min-w-0 flex-1">
          <p className={cn("mb-1 text-xs font-semibold uppercase tracking-wider", style.fg)}>{label}</p>
          <Markdown content={content} />
        </div>
      </aside>
    </BlockFrame>
  );
}

export async function ImageBlock({ src, alt, caption }: { src: string; alt?: string; caption?: string }) {
  const t = await getT("learning");
  return (
    <BlockFrame>
      <figure>
        <a href={src} target="_blank" rel="noopener noreferrer" className="group block overflow-hidden rounded-xl border border-border bg-surface-2" aria-label={alt ? t("learn.image.openNamed", { alt }) : t("learn.image.open")}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt={alt ?? caption ?? ""} loading="lazy" decoding="async" className="mx-auto max-h-[80vh] w-full object-contain transition-transform duration-300 group-hover:scale-[1.01]" />
        </a>
        {caption && <figcaption className="mt-2 text-center text-sm text-ink-muted">{caption}</figcaption>}
      </figure>
    </BlockFrame>
  );
}

function fileExtension(src: string): string {
  const clean = src.split(/[?#]/)[0] ?? "";
  const ext = clean.includes(".") ? clean.slice(clean.lastIndexOf(".") + 1) : "";
  return ext.length <= 5 ? ext.toUpperCase() : "";
}

export async function FileBlock({ src, title, sizeBytes }: { src: string; title: string; sizeBytes?: number }) {
  const [t, common] = await Promise.all([getT("learning"), getT("common")]);
  const ext = fileExtension(src);
  return (
    <BlockFrame interactive>
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface-1 p-4 shadow-card sm:flex-row sm:items-center">
        <span className="relative flex size-11 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
          <Icon.File className="size-5" />
          {ext && <span className="absolute -bottom-1 -end-1 rounded bg-accent px-1 text-[9px] font-bold leading-4 text-accent-fg">{ext}</span>}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-ink">{title || common("actions.download")}</p>
          <p className="text-xs text-ink-muted">
            {[ext ? t("learn.file.typed", { ext }) : t("learn.file.generic"), sizeBytes ? formatBytes(sizeBytes) : null].filter(Boolean).join(" · ")}
          </p>
        </div>
        <a href={src} download className={buttonClasses({ variant: "outline", size: "sm" })} target="_blank" rel="noopener noreferrer">
          <Icon.Download className="size-4" /> {common("actions.download")}
        </a>
      </div>
    </BlockFrame>
  );
}

export async function PdfBlock({ src, title }: { src: string; title?: string }) {
  const [t, common] = await Promise.all([getT("learning"), getT("common")]);
  const name = title || t("learn.pdf.document");
  return (
    <BlockFrame interactive>
      <div className="overflow-hidden rounded-xl border border-border bg-surface-1 shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface-2 px-3 py-2">
          <p className="flex min-w-0 items-center gap-2 text-sm font-medium text-ink">
            <Icon.FileText className="size-4 shrink-0 text-danger" />
            <span className="truncate">{name}</span>
          </p>
          <div className="flex items-center gap-1">
            <a href={src} target="_blank" rel="noopener noreferrer" className={buttonClasses({ variant: "ghost", size: "xs" })}>
              <Icon.ExternalLink className="size-3.5" /> {t("learn.openInNewTab")}
            </a>
            <a href={src} download className={buttonClasses({ variant: "ghost", size: "xs" })}>
              <Icon.Download className="size-3.5" /> {common("actions.download")}
            </a>
          </div>
        </div>
        {/* The browser's built-in PDF viewer; "Open in new tab" above is the fallback where it has none (most phones). */}
        <iframe src={src} title={name} loading="lazy" className="block h-[70vh] min-h-[420px] w-full border-0 bg-surface-2" />
      </div>
    </BlockFrame>
  );
}

export async function AudioBlock({ src, title, duration }: { src: string; title?: string; duration?: number }) {
  const [t, f] = await Promise.all([getT("learning"), getFormatter()]);
  return (
    <BlockFrame interactive>
      {(title || duration) && (
        <p className="mb-2 flex items-center gap-2 px-1 text-sm font-medium text-ink">
          <Icon.Audio className="size-4 text-accent" />
          <span className="min-w-0 truncate">{title || t("learn.audio")}</span>
          {duration ? <span className="ms-auto shrink-0 text-xs font-normal text-ink-muted">{f.duration(duration)}</span> : null}
        </p>
      )}
      <AudioPlayer src={src} title={title} className="shadow-card" />
    </BlockFrame>
  );
}

const BLOCKED_EMBED_HOSTS = /(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com|vimeo\.com)$/i;

type EmbedTarget =
  | { ok: true; url: string; host: string; sameOrigin: boolean }
  | { ok: false; reason: "invalid" | "video" | "unsafe" };

/** Uploaded files that a browser would run as a document (and so could execute script). */
const UNSAFE_UPLOAD_EMBED = /\.(svg|svgz|xml|xhtml|html?)$/i;

function embedTarget(src: string): EmbedTarget {
  const raw = src.trim();
  // A single leading slash is a path on this site; "//host" is protocol-relative and must go through URL parsing.
  const relative = raw.startsWith("/") && !raw.startsWith("//") && !raw.startsWith("/\\");
  let u: URL;
  try {
    u = relative ? new URL(raw, siteConfig.appUrl) : new URL(raw.startsWith("//") ? `https:${raw}` : raw);
  } catch {
    return { ok: false, reason: "invalid" };
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return { ok: false, reason: "invalid" };
  if (BLOCKED_EMBED_HOSTS.test(u.hostname)) return { ok: false, reason: "video" };
  let appOrigin = "";
  try {
    appOrigin = new URL(siteConfig.appUrl).origin;
  } catch {
    appOrigin = "";
  }
  const sameOrigin = relative || u.origin === appOrigin;
  if (sameOrigin && UNSAFE_UPLOAD_EMBED.test(u.pathname)) return { ok: false, reason: "unsafe" };
  if (relative) return { ok: true, url: `${u.pathname}${u.search}${u.hash}`, host: "", sameOrigin: true };
  return { ok: true, url: u.toString(), host: u.hostname.replace(/^www\./, ""), sameOrigin };
}

/**
 * Third-party embeds keep allow-same-origin so they can use their own storage. Pages on this site never get it:
 * allow-scripts + allow-same-origin on a same-origin frame would cancel the sandbox entirely.
 */
const EMBED_SANDBOX_CROSS_ORIGIN = "allow-scripts allow-same-origin allow-forms allow-popups allow-presentation allow-downloads";
const EMBED_SANDBOX_SAME_ORIGIN = "allow-scripts allow-forms allow-popups allow-presentation allow-downloads";

export async function EmbedBlock({ src, title, height }: { src: string; title?: string; height?: number }) {
  const t = await getT("learning");
  const target = embedTarget(src);
  if (!target.ok) {
    return (
      <BlockFrame interactive>
        <div className="flex items-start gap-3 rounded-xl border border-dashed border-border-strong bg-surface-2/60 p-4 text-sm">
          <Icon.AlertTriangle className="mt-0.5 size-5 shrink-0 text-warning" />
          <div className="min-w-0">
            <p className="font-medium text-ink">{target.reason === "video" ? t("learn.embed.videoTitle") : t("learn.embed.failedTitle")}</p>
            <p className="mt-0.5 text-ink-muted">
              {target.reason === "video"
                ? t("learn.embed.videoBody")
                : target.reason === "unsafe"
                  ? t("learn.embed.unsafeBody")
                  : t("learn.embed.invalidBody")}
            </p>
            {target.reason === "video" && (
              <a href={src} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 font-medium text-accent hover:underline">
                {t("learn.embed.openLink")} <Icon.ExternalLink className="size-3.5" />
              </a>
            )}
          </div>
        </div>
      </BlockFrame>
    );
  }
  const h = Math.min(Math.max(height ?? 480, 200), 1200);
  return (
    <BlockFrame interactive>
      <div className="overflow-hidden rounded-xl border border-border bg-surface-1">
        <iframe
          src={target.url}
          title={title || t("learn.embed.content")}
          loading="lazy"
          className="block h-60 w-full bg-surface-2 sm:h-(--embed-h)"
          style={{ "--embed-h": `${h}px` } as CSSProperties}
          sandbox={target.sameOrigin ? EMBED_SANDBOX_SAME_ORIGIN : EMBED_SANDBOX_CROSS_ORIGIN}
          referrerPolicy="strict-origin-when-cross-origin"
          allow="clipboard-write; fullscreen"
          allowFullScreen
        />
        <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-1.5 text-xs text-ink-muted">
          <span className="min-w-0 truncate">{title || target.host || t("learn.embed.content")}</span>
          <a href={target.url} target="_blank" rel="noopener noreferrer" className="inline-flex shrink-0 items-center gap-1 font-medium hover:text-ink">
            {t("learn.openInNewTab")} <Icon.ExternalLink className="size-3" />
          </a>
        </div>
      </div>
    </BlockFrame>
  );
}

/** Shown instead of quizzes/assignments/exercises for visitors who are not logged in. */
export async function LoginRequiredBlock({ kind, loginHref }: { kind: "quiz" | "assignment" | "exercise"; loginHref: string }) {
  const [t, shell] = await Promise.all([getT("learning"), getT("shell")]);
  const IconCmp = kind === "quiz" ? Icon.ListChecks : kind === "assignment" ? Icon.ClipboardList : Icon.Code;
  return (
    <BlockFrame interactive>
      <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-surface-1 px-6 py-12 text-center shadow-card">
        <span className="flex size-11 items-center justify-center rounded-full bg-surface-2 text-ink-muted">
          <IconCmp className="size-5" />
        </span>
        <p className="font-medium text-ink">{t("learn.loginRequired", { kind })}</p>
        <Link href={loginHref} className={buttonClasses({ size: "sm" })}>
          <Icon.LogIn className="size-4" /> {shell("header.logIn")}
        </Link>
      </div>
    </BlockFrame>
  );
}

export function DisabledBlock({ title, description }: { title: string; description: string }) {
  return (
    <BlockFrame interactive>
      <div className="flex items-start gap-3 rounded-xl border border-dashed border-border-strong bg-surface-2/60 p-4 text-sm">
        <Icon.Info className="mt-0.5 size-5 shrink-0 text-ink-faint" />
        <div>
          <p className="font-medium text-ink">{title}</p>
          <p className="mt-0.5 text-ink-muted">{description}</p>
        </div>
      </div>
    </BlockFrame>
  );
}
