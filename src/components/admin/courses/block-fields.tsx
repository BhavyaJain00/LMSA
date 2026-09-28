"use client";

import { useState } from "react";
import type { LessonBlock } from "@/lib/types";
import { cn, formatBytes, formatTime, isValidUrl, parseTime } from "@/lib/utils";
import { VideoPlayer, AudioPlayer } from "@/components/player";
import type { SeekMarker } from "@/components/player";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Icon } from "@/components/ui/icons";
import { SegmentedControl } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import type { AssessmentKind, AssessmentOption } from "./types";
import { CALLOUT_LABELS, CALLOUT_TONES, CODE_LANGUAGES, DEFAULT_EMBED_HEIGHT, isBlockedVideoHost, type CalloutTone } from "./blocks";
import { MarkdownEditor } from "./markdown-editor";
import { MediaField } from "./form-controls";
import { ASSESSMENT_COPY, AssessmentPickerDialog } from "./assessment-picker";
import { BlockIcon } from "./block-icon";

type BlockOf<T extends LessonBlock["type"]> = Extract<LessonBlock, { type: T }>;

interface EditorProps<T extends LessonBlock["type"]> {
  block: BlockOf<T>;
  onChange: (block: BlockOf<T>) => void;
}

let rowKey = 0;
const nextRowKey = () => ++rowKey;

/* ------------------------------------------------------------------ */
/* Small shared inputs                                                 */
/* ------------------------------------------------------------------ */

/** mm:ss / h:mm:ss input. Reports NaN while the text is not a valid time. */
function TimeInput({ value, onChange, label, invalid }: { value: number | undefined; onChange: (seconds: number) => void; label: string; invalid?: boolean }) {
  const [text, setText] = useState(() => (value !== undefined && Number.isFinite(value) ? formatTime(value) : ""));
  const parsed = text.trim() ? parseTime(text) : NaN;
  const bad = (text.trim() !== "" && Number.isNaN(parsed)) || invalid;
  return (
    <Input
      value={text}
      inputMode="numeric"
      placeholder="2:15"
      aria-label={label}
      invalid={bad}
      className="w-24 font-mono tabular-nums"
      onChange={(e) => {
        setText(e.target.value);
        const s = e.target.value.trim() ? parseTime(e.target.value) : NaN;
        onChange(s);
      }}
      onBlur={() => {
        if (Number.isFinite(parsed)) setText(formatTime(parsed));
      }}
    />
  );
}

function UrlHint({ url, allowVideoHosts = true }: { url: string; allowVideoHosts?: boolean }) {
  if (!url) return null;
  if (!isValidUrl(url)) return <p className="text-xs text-danger">Enter a full URL starting with https:// or upload a file.</p>;
  if (!allowVideoHosts && isBlockedVideoHost(url)) {
    return <p className="text-xs text-danger">YouTube and Vimeo can&apos;t be used. Upload the video file or paste a direct .mp4/.webm link.</p>;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Markdown & callout                                                  */
/* ------------------------------------------------------------------ */

export function MarkdownBlockEditor({ block, onChange }: EditorProps<"markdown">) {
  return (
    <MarkdownEditor
      value={block.content}
      onChange={(content) => onChange({ ...block, content })}
      rows={10}
      ariaLabel="Markdown content"
      placeholder={"Write the lesson text here. Use **bold**, _italic_, lists, links and `code`."}
    />
  );
}

const CALLOUT_STYLES: Record<CalloutTone, string> = {
  info: "border-l-info",
  success: "border-l-success",
  warning: "border-l-warning",
  danger: "border-l-danger",
};

export function CalloutBlockEditor({ block, onChange }: EditorProps<"callout">) {
  return (
    <div className="space-y-3">
      <SegmentedControl
        size="sm"
        value={block.tone}
        onChange={(tone) => onChange({ ...block, tone })}
        options={CALLOUT_TONES.map((t) => ({ value: t, label: CALLOUT_LABELS[t] }))}
      />
      <div className={cn("rounded-lg border-l-4", CALLOUT_STYLES[block.tone])}>
        <MarkdownEditor value={block.content} onChange={(content) => onChange({ ...block, content })} rows={4} compact ariaLabel="Callout text" placeholder="The tip, warning or note to highlight" />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Code                                                                */
/* ------------------------------------------------------------------ */

export function CodeBlockEditor({ block, onChange }: EditorProps<"code">) {
  const known = CODE_LANGUAGES.some((l) => l.value === block.language);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-sm font-medium text-ink" htmlFor={`code-lang-${block.id}`}>
          Language
        </label>
        <div className="w-48">
          <Select id={`code-lang-${block.id}`} value={block.language} onChange={(e) => onChange({ ...block, language: e.target.value })}>
            {!known && <option value={block.language}>{block.language}</option>}
            {CODE_LANGUAGES.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </Select>
        </div>
        <span className="text-xs text-ink-muted">{block.code ? `${block.code.split("\n").length} lines` : ""}</span>
      </div>
      <Textarea
        value={block.code}
        onChange={(e) => onChange({ ...block, code: e.target.value })}
        rows={Math.min(24, Math.max(6, block.code.split("\n").length + 1))}
        spellCheck={false}
        aria-label="Code"
        placeholder="Paste or type the code snippet"
        className="bg-surface-2 font-mono text-[13px] leading-relaxed"
        wrap="off"
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Embed                                                               */
/* ------------------------------------------------------------------ */

export function EmbedBlockEditor({ block, onChange }: EditorProps<"embed">) {
  const [preview, setPreview] = useState(false);
  const embeddable = !!block.src && /^https?:\/\//.test(block.src) && isValidUrl(block.src) && !isBlockedVideoHost(block.src);
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
        <Field label="Page URL" htmlFor={`embed-src-${block.id}`} required>
          <Input
            id={`embed-src-${block.id}`}
            type="url"
            value={block.src}
            onChange={(e) => onChange({ ...block, src: e.target.value.trim() })}
            placeholder="https://codepen.io/… or any page that allows embedding"
            leftAddon={<Icon.Globe className="size-4" />}
          />
        </Field>
        <Field label="Height (px)" htmlFor={`embed-h-${block.id}`}>
          <Input
            id={`embed-h-${block.id}`}
            type="number"
            min={150}
            max={1600}
            step={10}
            value={block.height ?? DEFAULT_EMBED_HEIGHT}
            onChange={(e) => onChange({ ...block, height: Number(e.target.value) || DEFAULT_EMBED_HEIGHT })}
          />
        </Field>
      </div>
      <UrlHint url={block.src} allowVideoHosts={false} />
      <Field label="Title" htmlFor={`embed-title-${block.id}`} hint="Describes the embedded page for screen readers.">
        <Input id={`embed-title-${block.id}`} value={block.title ?? ""} onChange={(e) => onChange({ ...block, title: e.target.value })} placeholder="e.g. Interactive flexbox playground" maxLength={200} />
      </Field>
      {embeddable && (
        <div>
          <Button variant="ghost" size="sm" onClick={() => setPreview((p) => !p)} leftIcon={preview ? <Icon.EyeOff className="size-4" /> : <Icon.Eye className="size-4" />}>
            {preview ? "Hide preview" : "Show preview"}
          </Button>
          {preview && (
            <iframe
              src={block.src}
              title={block.title || "Embedded content preview"}
              style={{ height: block.height ?? DEFAULT_EMBED_HEIGHT }}
              className="mt-2 w-full rounded-lg border border-border bg-surface-2"
              sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
              loading="lazy"
              referrerPolicy="no-referrer"
            />
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Image / file / PDF / audio                                          */
/* ------------------------------------------------------------------ */

export function ImageBlockEditor({ block, onChange }: EditorProps<"image">) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <MediaField kind="image" value={block.src} onChange={(src) => onChange({ ...block, src })} hint="PNG, JPG, GIF, WebP or SVG." />
      <div className="space-y-3">
        <Field label="Alt text" htmlFor={`img-alt-${block.id}`} hint="Describe the image for learners using screen readers.">
          <Input id={`img-alt-${block.id}`} value={block.alt ?? ""} onChange={(e) => onChange({ ...block, alt: e.target.value })} maxLength={300} placeholder="e.g. Diagram of the event loop" />
        </Field>
        <Field label="Caption" htmlFor={`img-cap-${block.id}`}>
          <Input id={`img-cap-${block.id}`} value={block.caption ?? ""} onChange={(e) => onChange({ ...block, caption: e.target.value })} maxLength={500} placeholder="Optional caption shown under the image" />
        </Field>
        <UrlHint url={block.src} />
        {block.src && isValidUrl(block.src) && (
          <figure className="overflow-hidden rounded-lg border border-border bg-surface-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={block.src} alt={block.alt ?? ""} className="mx-auto max-h-64 object-contain" />
            {block.caption && <figcaption className="border-t border-border px-3 py-1.5 text-center text-xs text-ink-muted">{block.caption}</figcaption>}
          </figure>
        )}
      </div>
    </div>
  );
}

export function FileBlockEditor({ block, onChange }: EditorProps<"file">) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <MediaField
        kind="document"
        value={block.src}
        onChange={(src, meta) =>
          onChange({
            ...block,
            src,
            title: block.title || meta?.name || "",
            sizeBytes: meta ? meta.size : src ? block.sizeBytes : undefined,
          })
        }
        hint="PDF, Office documents, ZIP, text or audio files (max 25 MB)."
      />
      <div className="space-y-3">
        <Field label="Title" htmlFor={`file-title-${block.id}`} required hint="Shown on the download button.">
          <Input id={`file-title-${block.id}`} value={block.title} onChange={(e) => onChange({ ...block, title: e.target.value })} maxLength={200} placeholder="e.g. Starter files" />
        </Field>
        <UrlHint url={block.src} />
        {block.src && (
          <p className="flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-2 text-sm text-ink">
            <Icon.Download className="size-4 text-ink-muted" />
            <span className="min-w-0 flex-1 truncate">{block.title || block.src.split("/").pop()}</span>
            {block.sizeBytes ? <span className="text-xs text-ink-muted">{formatBytes(block.sizeBytes)}</span> : null}
          </p>
        )}
      </div>
    </div>
  );
}

export function PdfBlockEditor({ block, onChange }: EditorProps<"pdf">) {
  const [preview, setPreview] = useState(false);
  return (
    <div className="space-y-3">
      <div className="grid gap-4 lg:grid-cols-2">
        <MediaField kind="document" accept=".pdf,application/pdf" value={block.src} onChange={(src) => onChange({ ...block, src })} hint="Upload a PDF (max 25 MB) or link to one." />
        <div className="space-y-3">
          <Field label="Title" htmlFor={`pdf-title-${block.id}`}>
            <Input id={`pdf-title-${block.id}`} value={block.title ?? ""} onChange={(e) => onChange({ ...block, title: e.target.value })} maxLength={200} placeholder="e.g. Cheat sheet" />
          </Field>
          <UrlHint url={block.src} />
          {block.src && isValidUrl(block.src) && (
            <Button variant="ghost" size="sm" onClick={() => setPreview((p) => !p)} leftIcon={preview ? <Icon.EyeOff className="size-4" /> : <Icon.Eye className="size-4" />}>
              {preview ? "Hide preview" : "Show preview"}
            </Button>
          )}
        </div>
      </div>
      {preview && block.src && <iframe src={block.src} title={block.title || "PDF preview"} className="h-[480px] w-full rounded-lg border border-border bg-surface-2" />}
    </div>
  );
}

export function AudioBlockEditor({ block, onChange }: EditorProps<"audio">) {
  const [detect, setDetect] = useState(block.duration ? "" : block.src);
  return (
    <div className="space-y-3">
      <div className="grid gap-4 lg:grid-cols-2">
        <MediaField
          kind="document"
          accept="audio/*"
          value={block.src}
          onChange={(src) => {
            setDetect(src);
            onChange({ ...block, src, duration: undefined });
          }}
          hint="MP3, M4A, OGG, WAV or WebM audio."
        />
        <div className="space-y-3">
          <Field label="Title" htmlFor={`audio-title-${block.id}`}>
            <Input id={`audio-title-${block.id}`} value={block.title ?? ""} onChange={(e) => onChange({ ...block, title: e.target.value })} maxLength={200} placeholder="e.g. Episode 3: Interview" />
          </Field>
          <UrlHint url={block.src} />
          <p className="text-xs text-ink-muted">
            Duration: {block.duration ? formatTime(block.duration) : detect && detect === block.src ? "detecting…" : "unknown"}
          </p>
        </div>
      </div>
      {detect && detect === block.src && isValidUrl(block.src) && (
        <audio
          key={block.src}
          src={block.src}
          preload="metadata"
          className="hidden"
          onLoadedMetadata={(e) => {
            const d = Math.round(e.currentTarget.duration);
            setDetect("");
            if (Number.isFinite(d) && d > 0) onChange({ ...block, duration: d });
          }}
          onError={() => setDetect("")}
        />
      )}
      {block.src && isValidUrl(block.src) && <AudioPlayer key={block.src} src={block.src} title={block.title} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Video                                                               */
/* ------------------------------------------------------------------ */

export function VideoBlockEditor({ block, onChange, quizzes }: EditorProps<"video"> & { quizzes: AssessmentOption[] }) {
  const [detect, setDetect] = useState<{ src: string; status: "loading" | "error" } | null>(() => (block.src && !block.duration ? { src: block.src, status: "loading" } : null));
  const [durationKey, setDurationKey] = useState(0);
  const [preview, setPreview] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const chapters = block.chapters ?? [];
  const markers = block.quizMarkers ?? [];
  const [chapterKeys, setChapterKeys] = useState(() => chapters.map(() => nextRowKey()));
  const [markerKeys, setMarkerKeys] = useState(() => markers.map(() => nextRowKey()));

  const srcOk = !!block.src && isValidUrl(block.src) && !isBlockedVideoHost(block.src);
  const detecting = detect?.src === block.src && detect.status === "loading" && srcOk;
  const duration = block.duration;
  const quizTitle = new Map(quizzes.map((q) => [q.id, q.title]));

  const setSrc = (src: string) => {
    setDetect(src ? { src, status: "loading" } : null);
    setDurationKey((k) => k + 1);
    onChange({ ...block, src, duration: undefined });
  };
  const nextTime = () => {
    if (preview && currentTime > 0) return Math.floor(currentTime);
    const last = chapters[chapters.length - 1]?.time;
    return last !== undefined && Number.isFinite(last) ? last + 60 : 0;
  };

  const validChapters = chapters.filter((c) => Number.isFinite(c.time) && c.title.trim()).sort((a, b) => a.time - b.time);
  const seekMarkers: SeekMarker[] = markers
    .filter((m) => Number.isFinite(m.time) && m.quizId)
    .map((m, i) => ({ time: m.time, id: `${m.quizId}-${i}`, label: quizTitle.get(m.quizId) ?? "Quiz", kind: "quiz" }));

  return (
    <div className="space-y-5">
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3">
          <Field label="Video" required>
            <MediaField kind="video" value={block.src} onChange={setSrc} urlPlaceholder="https://example.com/lesson.mp4" hint="MP4, WebM or OGG. Upload the file or paste a direct link — YouTube and Vimeo aren't supported." />
          </Field>
          <UrlHint url={block.src} allowVideoHosts={false} />
        </div>
        <div className="space-y-3">
          <Field label="Title" htmlFor={`video-title-${block.id}`}>
            <Input id={`video-title-${block.id}`} value={block.title ?? ""} onChange={(e) => onChange({ ...block, title: e.target.value })} maxLength={200} placeholder="e.g. Setting up your editor" />
          </Field>
          <div>
            <p className="mb-1.5 text-sm font-medium text-ink">Duration</p>
            <div className="flex flex-wrap items-center gap-2">
              <TimeInput
                key={durationKey}
                value={duration}
                label="Video duration"
                onChange={(s) => onChange({ ...block, duration: Number.isFinite(s) && s > 0 ? Math.round(s) : undefined })}
              />
              {detecting ? (
                <span className="inline-flex items-center gap-1.5 text-xs text-ink-muted">
                  <Icon.Loader className="size-3.5 animate-spin" /> Detecting duration…
                </span>
              ) : detect?.src === block.src && detect.status === "error" ? (
                <span className="text-xs text-warning">Couldn&apos;t read the duration. Enter it manually.</span>
              ) : srcOk ? (
                <Button variant="ghost" size="xs" onClick={() => setDetect({ src: block.src, status: "loading" })} leftIcon={<Icon.Refresh className="size-3.5" />}>
                  Detect
                </Button>
              ) : null}
            </div>
            <p className="mt-1.5 text-xs text-ink-muted">Used for the lesson&apos;s estimated time and completion tracking.</p>
          </div>
        </div>
      </div>

      {detecting && (
        <video
          key={block.src}
          src={block.src}
          preload="metadata"
          muted
          className="hidden"
          onLoadedMetadata={(e) => {
            const d = Math.round(e.currentTarget.duration);
            if (Number.isFinite(d) && d > 0) {
              setDetect(null);
              setDurationKey((k) => k + 1);
              onChange({ ...block, duration: d });
            } else {
              setDetect({ src: block.src, status: "error" });
            }
          }}
          onError={() => setDetect({ src: block.src, status: "error" })}
        />
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Field label="Poster image" hint="Shown before playback starts.">
          <MediaField kind="image" value={block.posterUrl ?? ""} onChange={(posterUrl) => onChange({ ...block, posterUrl: posterUrl || undefined })} />
        </Field>
        <Field label="Captions (.vtt)" hint="WebVTT subtitles learners can turn on in the player.">
          <MediaField kind="document" accept=".vtt,text/vtt" value={block.captionsUrl ?? ""} onChange={(captionsUrl) => onChange({ ...block, captionsUrl: captionsUrl || undefined })} urlPlaceholder="https://example.com/captions.vtt" />
        </Field>
      </div>

      <section aria-labelledby={`chapters-${block.id}`} className="rounded-xl border border-border p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h4 id={`chapters-${block.id}`} className="text-sm font-semibold text-ink">
              Chapters
            </h4>
            <p className="text-xs text-ink-muted">Named sections on the seek bar. Times are mm:ss from the start.</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            leftIcon={<Icon.Plus className="size-4" />}
            onClick={() => {
              setChapterKeys((k) => [...k, nextRowKey()]);
              onChange({ ...block, chapters: [...chapters, { time: nextTime(), title: "" }] });
            }}
          >
            {preview && currentTime > 0 ? `Add at ${formatTime(currentTime)}` : "Add chapter"}
          </Button>
        </div>
        {chapters.length === 0 ? (
          <p className="text-sm text-ink-muted">No chapters yet.</p>
        ) : (
          <ul className="space-y-2">
            {chapters.map((c, i) => {
              const tooLate = duration !== undefined && Number.isFinite(c.time) && c.time > duration;
              return (
                <li key={chapterKeys[i] ?? i} className="flex flex-wrap items-center gap-2">
                  <TimeInput value={c.time} label={`Chapter ${i + 1} start time`} invalid={tooLate} onChange={(time) => onChange({ ...block, chapters: chapters.map((x, j) => (j === i ? { ...x, time } : x)) })} />
                  <Input
                    value={c.title}
                    onChange={(e) => onChange({ ...block, chapters: chapters.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)) })}
                    placeholder="Chapter title"
                    aria-label={`Chapter ${i + 1} title`}
                    maxLength={200}
                    className="min-w-40 flex-1"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setChapterKeys((k) => k.filter((_, j) => j !== i));
                      onChange({ ...block, chapters: chapters.filter((_, j) => j !== i) });
                    }}
                    className="rounded-md p-2 text-ink-faint hover:bg-danger/10 hover:text-danger"
                    aria-label={`Remove chapter ${i + 1}`}
                  >
                    <Icon.Trash className="size-4" />
                  </button>
                  {tooLate && <p className="w-full text-xs text-danger">This chapter starts after the end of the video.</p>}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby={`markers-${block.id}`} className="rounded-xl border border-border p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h4 id={`markers-${block.id}`} className="text-sm font-semibold text-ink">
              Quizzes in this video
            </h4>
            <p className="text-xs text-ink-muted">Playback pauses at each time and the quiz opens.</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            leftIcon={<Icon.Plus className="size-4" />}
            disabled={quizzes.length === 0}
            title={quizzes.length === 0 ? "Create a quiz first" : undefined}
            onClick={() => {
              setMarkerKeys((k) => [...k, nextRowKey()]);
              onChange({ ...block, quizMarkers: [...markers, { time: preview && currentTime > 0 ? Math.floor(currentTime) : 0, quizId: "" }] });
            }}
          >
            Add Quiz to Video
          </Button>
        </div>
        {markers.length === 0 ? (
          <p className="text-sm italic text-ink-muted">No quizzes added yet.</p>
        ) : (
          <ul className="space-y-2">
            {markers.map((m, i) => {
              const tooLate = duration !== undefined && Number.isFinite(m.time) && m.time > duration;
              return (
                <li key={markerKeys[i] ?? i} className="flex flex-wrap items-center gap-2">
                  <TimeInput value={m.time} label={`Quiz ${i + 1} time in video`} invalid={tooLate} onChange={(time) => onChange({ ...block, quizMarkers: markers.map((x, j) => (j === i ? { ...x, time } : x)) })} />
                  <div className="min-w-48 flex-1">
                    <Select
                      value={m.quizId}
                      aria-label={`Quiz ${i + 1}`}
                      invalid={!m.quizId}
                      onChange={(e) => onChange({ ...block, quizMarkers: markers.map((x, j) => (j === i ? { ...x, quizId: e.target.value } : x)) })}
                    >
                      <option value="">Select a quiz</option>
                      {quizzes.map((q) => (
                        <option key={q.id} value={q.id}>
                          {q.title}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setMarkerKeys((k) => k.filter((_, j) => j !== i));
                      onChange({ ...block, quizMarkers: markers.filter((_, j) => j !== i) });
                    }}
                    className="rounded-md p-2 text-ink-faint hover:bg-danger/10 hover:text-danger"
                    aria-label={`Remove quiz ${i + 1} from the video`}
                  >
                    <Icon.Trash className="size-4" />
                  </button>
                  {tooLate && <p className="w-full text-xs text-danger">Time in video exceeds the total duration of the video.</p>}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {srcOk && (
        <div>
          <Button variant="ghost" size="sm" onClick={() => setPreview((p) => !p)} leftIcon={preview ? <Icon.EyeOff className="size-4" /> : <Icon.Play className="size-4" />}>
            {preview ? "Hide preview" : "Preview in player"}
          </Button>
          {preview && (
            <div className="mt-2 overflow-hidden rounded-xl border border-border">
              <VideoPlayer
                key={`${block.src}|${block.captionsUrl ?? ""}`}
                src={block.src}
                poster={block.posterUrl}
                captionsUrl={block.captionsUrl}
                title={block.title}
                chapters={validChapters}
                markers={seekMarkers}
                onTimeChange={setCurrentTime}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Quiz / assignment / exercise                                        */
/* ------------------------------------------------------------------ */

export function AssessmentBlockEditor({
  kind,
  value,
  options,
  courseId,
  onChange,
  onRefresh,
  refreshing,
}: {
  kind: AssessmentKind;
  value: string;
  options: AssessmentOption[];
  courseId: string;
  onChange: (id: string) => void;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const copy = ASSESSMENT_COPY[kind];
  const [open, setOpen] = useState(false);
  const [pickerKey, setPickerKey] = useState(0);
  const selected = options.find((o) => o.id === value);
  const typeLabel = kind === "quiz" ? "Quiz" : kind === "assignment" ? "Assignment" : "Programming Exercise";

  const openPicker = () => {
    setPickerKey((k) => k + 1);
    setOpen(true);
  };

  return (
    <div>
      {selected ? (
        <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface-2/50 p-4 sm:flex-row sm:items-center">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
            <BlockIcon type={kind} className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-ink">
              {typeLabel}: {selected.title}
            </p>
            <p className="truncate text-xs text-ink-muted">{[selected.meta, selected.courseTitle].filter(Boolean).join(" · ")}</p>
          </div>
          <div className="flex shrink-0 gap-2">
            <a href={copy.editHref(selected.id)} target="_blank" rel="noopener" className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-ink hover:bg-surface-3">
              Edit <Icon.ExternalLink className="size-3.5" />
            </a>
            <Button variant="outline" size="sm" onClick={openPicker}>
              Change
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border-strong px-4 py-6 text-center">
          <span className="flex size-10 items-center justify-center rounded-full bg-surface-2 text-ink-faint">
            <BlockIcon type={kind} className="size-5" />
          </span>
          {value ? (
            <Badge tone="danger">The selected {copy.noun} no longer exists</Badge>
          ) : (
            <p className="text-sm text-ink-muted">No {copy.noun} selected yet.</p>
          )}
          <div className="flex flex-wrap justify-center gap-2">
            <Button size="sm" onClick={openPicker} leftIcon={<Icon.Search className="size-4" />}>
              Choose {copy.noun}
            </Button>
            <a href={copy.createHref} target="_blank" rel="noopener" className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border-strong px-3 text-sm font-medium text-ink hover:bg-surface-2">
              <Icon.Plus className="size-4" /> Create new
            </a>
          </div>
        </div>
      )}
      <AssessmentPickerDialog
        key={pickerKey}
        open={open}
        kind={kind}
        options={options}
        courseId={courseId}
        value={value}
        onClose={() => setOpen(false)}
        onSelect={(id) => {
          onChange(id);
          setOpen(false);
        }}
        onRefresh={onRefresh}
        refreshing={refreshing}
      />
    </div>
  );
}
