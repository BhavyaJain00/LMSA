/**
 * Lesson block helpers shared by the block editor (client) and the lesson
 * Server Actions (validation, duration). No server-only imports here.
 */
import type { LessonBlock, LessonBlockType, VideoChapterMarker, VideoQuizMarker } from "@/lib/types";
import { siteConfig } from "@/lib/config";
import { isValidUrl, readingTimeSeconds, uid } from "@/lib/utils";

export interface BlockTypeMeta {
  type: LessonBlockType;
  label: string;
  description: string;
}

export const BLOCK_TYPES: BlockTypeMeta[] = [
  { type: "markdown", label: "Markdown", description: "Rich text with headings, lists, links and code" },
  { type: "video", label: "Video", description: "Upload an MP4/WebM or paste a direct video URL" },
  { type: "audio", label: "Audio", description: "Podcast-style audio clip" },
  { type: "pdf", label: "PDF", description: "Readable document shown inline" },
  { type: "image", label: "Image", description: "Picture with alt text and caption" },
  { type: "file", label: "File", description: "Downloadable attachment" },
  { type: "code", label: "Code", description: "Syntax-labelled code snippet" },
  { type: "embed", label: "Embed", description: "Any iframe-able page (not video)" },
  { type: "quiz", label: "Quiz", description: "Link a quiz from the question bank" },
  { type: "assignment", label: "Assignment", description: "Collect a submission for grading" },
  { type: "exercise", label: "Exercise", description: "Programming exercise with test cases" },
  { type: "callout", label: "Callout", description: "Highlighted tip, warning or note" },
];

export const BLOCK_LABELS: Record<LessonBlockType, string> = Object.fromEntries(BLOCK_TYPES.map((b) => [b.type, b.label])) as Record<
  LessonBlockType,
  string
>;

export const CODE_LANGUAGES: { value: string; label: string }[] = [
  { value: "plaintext", label: "Plain text" },
  { value: "bash", label: "Bash" },
  { value: "c", label: "C" },
  { value: "cpp", label: "C++" },
  { value: "csharp", label: "C#" },
  { value: "css", label: "CSS" },
  { value: "diff", label: "Diff" },
  { value: "go", label: "Go" },
  { value: "html", label: "HTML" },
  { value: "http", label: "HTTP" },
  { value: "java", label: "Java" },
  { value: "javascript", label: "JavaScript" },
  { value: "json", label: "JSON" },
  { value: "jsx", label: "JSX" },
  { value: "kotlin", label: "Kotlin" },
  { value: "markdown", label: "Markdown" },
  { value: "php", label: "PHP" },
  { value: "python", label: "Python" },
  { value: "ruby", label: "Ruby" },
  { value: "rust", label: "Rust" },
  { value: "scss", label: "SCSS" },
  { value: "shell", label: "Shell session" },
  { value: "sql", label: "SQL" },
  { value: "swift", label: "Swift" },
  { value: "toml", label: "TOML" },
  { value: "tsx", label: "TSX" },
  { value: "typescript", label: "TypeScript" },
  { value: "yaml", label: "YAML" },
];

export const CALLOUT_TONES = ["info", "success", "warning", "danger"] as const;
export type CalloutTone = (typeof CALLOUT_TONES)[number];

export const CALLOUT_LABELS: Record<CalloutTone, string> = {
  info: "Note",
  success: "Tip",
  warning: "Warning",
  danger: "Important",
};

export const DEFAULT_EMBED_HEIGHT = 480;

/** YouTube/Vimeo are never embedded: videos must be self-hosted files. */
export function isBlockedVideoHost(url: string): boolean {
  try {
    const u = new URL(url, "http://local");
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    return (
      host === "youtube.com" ||
      host.endsWith(".youtube.com") ||
      host === "youtu.be" ||
      host === "youtube-nocookie.com" ||
      host.endsWith(".youtube-nocookie.com") ||
      host === "vimeo.com" ||
      host.endsWith(".vimeo.com")
    );
  } catch {
    return false;
  }
}

/** Create an empty block of a given type. */
export function createBlock(type: LessonBlockType, id: string = uid("blk")): LessonBlock {
  switch (type) {
    case "markdown":
      return { id, type, content: "" };
    case "video":
      return { id, type, src: "", chapters: [], quizMarkers: [] };
    case "audio":
      return { id, type, src: "" };
    case "pdf":
      return { id, type, src: "" };
    case "image":
      return { id, type, src: "", alt: "", caption: "" };
    case "file":
      return { id, type, src: "", title: "" };
    case "code":
      return { id, type, language: "javascript", code: "" };
    case "embed":
      return { id, type, src: "", height: DEFAULT_EMBED_HEIGHT };
    case "quiz":
      return { id, type, quizId: "" };
    case "assignment":
      return { id, type, assignmentId: "" };
    case "exercise":
      return { id, type, exerciseId: "" };
    case "callout":
      return { id, type, tone: "info", content: "" };
  }
}

/** Deep copy of a block with a fresh id (used by "Duplicate"). */
export function duplicateBlock(block: LessonBlock): LessonBlock {
  const copy = JSON.parse(JSON.stringify(block)) as LessonBlock;
  return { ...copy, id: uid("blk") };
}

/** Whether a block holds anything worth confirming before deletion. */
export function blockHasContent(block: LessonBlock): boolean {
  switch (block.type) {
    case "markdown":
    case "callout":
      return block.content.trim().length > 0;
    case "code":
      return block.code.trim().length > 0;
    case "quiz":
      return !!block.quizId;
    case "assignment":
      return !!block.assignmentId;
    case "exercise":
      return !!block.exerciseId;
    default:
      return !!block.src;
  }
}

/** Estimated lesson duration: video + audio lengths plus reading time of text blocks. */
export function computeLessonDuration(blocks: LessonBlock[]): number {
  let total = 0;
  for (const b of blocks) {
    if (b.type === "video" || b.type === "audio") total += Math.max(0, Math.round(b.duration ?? 0));
    else if (b.type === "markdown" || b.type === "callout") total += readingTimeSeconds(b.content);
  }
  return total;
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

export interface BlockValidationContext {
  quizIds: Set<string>;
  assignmentIds: Set<string>;
  exerciseIds: Set<string>;
  /** Replace every block id with a fresh one (imports). */
  regenerateIds?: boolean;
  /** Map old assessment ids to new ones (imports). */
  remap?: { quizzes?: Map<string, string>; assignments?: Map<string, string>; exercises?: Map<string, string> };
}

export interface BlockValidationResult {
  blocks: LessonBlock[];
  /** Keyed by block id (after regeneration). */
  errors: Record<string, string>;
}

const MAX_BLOCKS = 200;
const MAX_TEXT = 100_000;

type Raw = Record<string, unknown>;

const str = (v: unknown, max = MAX_TEXT): string => (typeof v === "string" ? v.slice(0, max) : "");
const optStr = (v: unknown, max = 2000): string | undefined => {
  const s = typeof v === "string" ? v.trim().slice(0, max) : "";
  return s ? s : undefined;
};
const num = (v: unknown): number | undefined => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : undefined;
};

/** Last path segment of a URL, decoded when possible ("Download" when empty). */
export function fileNameFromUrl(url: string): string {
  const last = url.split(/[?#]/)[0]!.split("/").pop() || "Download";
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

function checkUrl(url: string, label: string, opts: { required?: boolean; noVideoHosts?: boolean } = {}): string | null {
  if (!url) return opts.required ? `Add ${label}.` : null;
  if (!isValidUrl(url)) return `Enter a valid URL for ${label} (https://… or an uploaded file).`;
  if (opts.noVideoHosts && isBlockedVideoHost(url)) return "YouTube and Vimeo links can't be used. Upload the video file or use a direct .mp4/.webm URL.";
  return null;
}

/** Hostnames that serve this site (configured APP_URL plus local aliases). */
function appHostnames(): Set<string> {
  const hosts = new Set(["localhost", "127.0.0.1", "[::1]", "0.0.0.0"]);
  try {
    hosts.add(new URL(siteConfig.appUrl).hostname.toLowerCase());
  } catch {
    // An invalid APP_URL leaves only the local aliases.
  }
  return hosts;
}

/**
 * Embeds render in an iframe that third-party pages need to be scriptable, so
 * pages from this site (uploads included) must never be embedded: they would
 * run with the viewer's session. Only absolute http(s) URLs on other hosts pass.
 */
export function checkEmbedUrl(src: string): string | null {
  if (src.startsWith("/") || src.startsWith("\\")) return "Embeds must use a full http(s) URL to another site.";
  let u: URL;
  try {
    u = new URL(src);
  } catch {
    return "Enter a valid URL for the page to embed.";
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return "Embeds must use an http(s) URL.";
  const host = u.hostname.toLowerCase();
  if (appHostnames().has(host)) return "Pages and files from this site can't be embedded. Use an Image, PDF or File block for uploads.";
  return null;
}

/**
 * Validate and normalize untrusted block JSON coming from the editor or an
 * import file. Unknown fields are dropped; every block gets a unique id.
 */
export function sanitizeBlocks(raw: unknown, ctx: BlockValidationContext): BlockValidationResult {
  const errors: Record<string, string> = {};
  const blocks: LessonBlock[] = [];
  if (!Array.isArray(raw)) return { blocks, errors: { _: "Lesson content is malformed." } };
  if (raw.length > MAX_BLOCKS) return { blocks, errors: { _: `A lesson can have at most ${MAX_BLOCKS} blocks.` } };

  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Raw;
    let id = typeof r.id === "string" && /^[\w-]{1,64}$/.test(r.id) ? r.id : "";
    if (ctx.regenerateIds || !id || seen.has(id)) id = uid("blk");
    seen.add(id);
    const fail = (message: string) => {
      if (!errors[id]) errors[id] = message;
    };

    switch (r.type) {
      case "markdown": {
        blocks.push({ id, type: "markdown", content: str(r.content) });
        break;
      }
      case "callout": {
        const tone = (CALLOUT_TONES as readonly string[]).includes(r.tone as string) ? (r.tone as CalloutTone) : "info";
        const content = str(r.content);
        if (!content.trim()) fail("Write the callout text.");
        blocks.push({ id, type: "callout", tone, content });
        break;
      }
      case "code": {
        const language = typeof r.language === "string" && /^[\w+#-]{1,24}$/.test(r.language) ? r.language : "plaintext";
        const code = str(r.code);
        if (!code.trim()) fail("Add some code or remove this block.");
        blocks.push({ id, type: "code", language, code });
        break;
      }
      case "video": {
        const src = str(r.src, 2000).trim();
        const err = checkUrl(src, "a video file or URL", { required: true, noVideoHosts: true });
        if (err) fail(err);
        const posterUrl = optStr(r.posterUrl);
        const captionsUrl = optStr(r.captionsUrl);
        if (posterUrl) {
          const e = checkUrl(posterUrl, "the poster image");
          if (e) fail(e);
        }
        if (captionsUrl) {
          const e = checkUrl(captionsUrl, "the captions file");
          if (e) fail(e);
        }
        const duration = num(r.duration);
        const chapters: VideoChapterMarker[] = [];
        if (Array.isArray(r.chapters)) {
          for (const c of r.chapters as Raw[]) {
            if (!c || typeof c !== "object") continue;
            const time = num(c.time);
            const title = optStr(c.title, 200);
            if (time === undefined) {
              fail("Every video chapter needs a valid start time (mm:ss).");
              continue;
            }
            if (!title) {
              fail("Every video chapter needs a title.");
              continue;
            }
            if (duration && time > duration) fail(`Chapter "${title}" starts after the end of the video.`);
            chapters.push({ time: Math.round(time), title });
          }
        }
        chapters.sort((a, b) => a.time - b.time);
        const quizMarkers: VideoQuizMarker[] = [];
        if (Array.isArray(r.quizMarkers)) {
          for (const m of r.quizMarkers as Raw[]) {
            if (!m || typeof m !== "object") continue;
            const time = num(m.time);
            let quizId = typeof m.quizId === "string" ? m.quizId : "";
            if (ctx.remap?.quizzes?.has(quizId)) quizId = ctx.remap.quizzes.get(quizId)!;
            if (time === undefined) {
              fail("Please enter a valid timestamp for every in-video quiz.");
              continue;
            }
            if (!quizId) {
              fail("Please select a quiz for every in-video quiz marker.");
              continue;
            }
            if (!ctx.quizIds.has(quizId)) {
              fail("An in-video quiz no longer exists. Remove it or pick another quiz.");
              continue;
            }
            if (duration && time > duration) fail("Time in video exceeds the total duration of the video.");
            quizMarkers.push({ time: Math.round(time), quizId });
          }
        }
        quizMarkers.sort((a, b) => a.time - b.time);
        blocks.push({
          id,
          type: "video",
          src,
          posterUrl,
          captionsUrl,
          duration: duration !== undefined ? Math.round(duration) : undefined,
          chapters,
          quizMarkers,
          title: optStr(r.title, 200),
        });
        break;
      }
      case "audio": {
        const src = str(r.src, 2000).trim();
        const err = checkUrl(src, "an audio file or URL", { required: true });
        if (err) fail(err);
        const duration = num(r.duration);
        blocks.push({ id, type: "audio", src, title: optStr(r.title, 200), duration: duration !== undefined ? Math.round(duration) : undefined });
        break;
      }
      case "pdf": {
        const src = str(r.src, 2000).trim();
        const err = checkUrl(src, "a PDF file or URL", { required: true });
        if (err) fail(err);
        blocks.push({ id, type: "pdf", src, title: optStr(r.title, 200) });
        break;
      }
      case "image": {
        const src = str(r.src, 2000).trim();
        const err = checkUrl(src, "an image file or URL", { required: true });
        if (err) fail(err);
        blocks.push({ id, type: "image", src, alt: optStr(r.alt, 300), caption: optStr(r.caption, 500) });
        break;
      }
      case "file": {
        const src = str(r.src, 2000).trim();
        const err = checkUrl(src, "a file or URL", { required: true });
        if (err) fail(err);
        const title = optStr(r.title, 200) ?? (src ? fileNameFromUrl(src) : "");
        if (!title) fail("Give the file a title.");
        const sizeBytes = num(r.sizeBytes);
        blocks.push({ id, type: "file", src, title: title ?? "", sizeBytes: sizeBytes !== undefined ? Math.round(sizeBytes) : undefined });
        break;
      }
      case "embed": {
        const src = str(r.src, 2000).trim();
        let err = checkUrl(src, "the page URL to embed", { required: true, noVideoHosts: true });
        if (!err) err = checkEmbedUrl(src);
        if (err) fail(err);
        const rawHeight = num(r.height);
        const height = rawHeight ? Math.min(1600, Math.max(150, Math.round(rawHeight))) : DEFAULT_EMBED_HEIGHT;
        blocks.push({ id, type: "embed", src, title: optStr(r.title, 200), height });
        break;
      }
      case "quiz": {
        let quizId = typeof r.quizId === "string" ? r.quizId : "";
        if (ctx.remap?.quizzes?.has(quizId)) quizId = ctx.remap.quizzes.get(quizId)!;
        if (!quizId) fail("Please select a quiz.");
        else if (!ctx.quizIds.has(quizId)) fail("The selected quiz no longer exists.");
        blocks.push({ id, type: "quiz", quizId });
        break;
      }
      case "assignment": {
        let assignmentId = typeof r.assignmentId === "string" ? r.assignmentId : "";
        if (ctx.remap?.assignments?.has(assignmentId)) assignmentId = ctx.remap.assignments.get(assignmentId)!;
        if (!assignmentId) fail("Please select an assignment.");
        else if (!ctx.assignmentIds.has(assignmentId)) fail("The selected assignment no longer exists.");
        blocks.push({ id, type: "assignment", assignmentId });
        break;
      }
      case "exercise": {
        let exerciseId = typeof r.exerciseId === "string" ? r.exerciseId : "";
        if (ctx.remap?.exercises?.has(exerciseId)) exerciseId = ctx.remap.exercises.get(exerciseId)!;
        if (!exerciseId) fail("Please select a programming exercise.");
        else if (!ctx.exerciseIds.has(exerciseId)) fail("The selected exercise no longer exists.");
        blocks.push({ id, type: "exercise", exerciseId });
        break;
      }
      default:
        // Unknown block types are dropped silently.
        break;
    }
  }
  return { blocks, errors };
}
