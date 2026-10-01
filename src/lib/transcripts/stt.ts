import type { TimedSegment, TimedWord } from "./cues";

/**
 * Pure helpers for automatic transcription with an OpenAI-compatible
 * speech-to-text endpoint (`POST /v1/audio/transcriptions`): endpoint
 * normalization, the ffmpeg audio-extraction command, response parsing and
 * language names. The process/network side lives in `auto.ts`.
 */

/** Upload limit of OpenAI-compatible endpoints (bytes). */
export const MAX_AUDIO_PART_BYTES = 25 * 1024 * 1024;
/** Audio is sent in parts of at most this many seconds. */
export const AUDIO_PART_SECONDS = 600;

export type AudioCodec = "mp3" | "wav";

/**
 * The transcription endpoint for a configured URL: a full
 * `…/audio/transcriptions` URL is used as is; a base URL such as
 * `https://api.openai.com/v1` gets the path appended. Null when the value is
 * not an http(s) URL.
 */
export function transcriptionEndpoint(configured: string): string | null {
  const value = configured.trim();
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const path = url.pathname.replace(/\/+$/, "");
  url.pathname = /\/audio\/transcriptions$/.test(path) ? path : `${path}/audio/transcriptions`;
  return url.href;
}

/**
 * ffmpeg arguments that write the first audio track as 16 kHz mono parts of
 * `partSeconds` each into the working directory: 32 kbit/s MP3 (2.4 MB per
 * 10 minutes) or, when the build lacks an MP3 encoder, 16-bit WAV
 * (19.2 MB per 10 minutes) — both below the 25 MB request limit.
 */
export function audioExtractArgs(input: string, codec: AudioCodec, partSeconds = AUDIO_PART_SECONDS): string[] {
  const encode = codec === "mp3" ? ["-c:a", "libmp3lame", "-b:a", "32k"] : ["-c:a", "pcm_s16le"];
  return [
    "-hide_banner",
    "-nostdin",
    "-y",
    "-progress",
    "pipe:1",
    "-nostats",
    "-i",
    input,
    "-map",
    "0:a:0",
    "-vn",
    "-sn",
    "-dn",
    "-ac",
    "1",
    "-ar",
    "16000",
    ...encode,
    "-f",
    "segment",
    "-segment_time",
    String(partSeconds),
    "-reset_timestamps",
    "1",
    `part_%03d.${codec}`,
  ];
}

/** Whether ffmpeg failed because the MP3 encoder is missing from the build. */
export function isMissingEncoderError(stderr: string): boolean {
  return /Unknown encoder 'libmp3lame'|Encoder libmp3lame not found|Encoder not found/i.test(stderr);
}

/** Part files written by `audioExtractArgs`, in playback order. */
export function sortAudioParts(files: readonly string[], codec: AudioCodec): string[] {
  const re = new RegExp(`^part_(\\d{3,})\\.${codec}$`);
  return files
    .map((f) => ({ f, m: re.exec(f) }))
    .filter((x): x is { f: string; m: RegExpExecArray } => !!x.m)
    .sort((a, b) => Number(a.m[1]) - Number(b.m[1]))
    .map((x) => x.f);
}

function num(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
}

/** Word timings from a `words` array (entries without finite times or text are skipped). */
function parseWords(list: unknown): TimedWord[] {
  if (!Array.isArray(list)) return [];
  return list.flatMap((w) => {
    if (!w || typeof w !== "object") return [];
    const r = w as Record<string, unknown>;
    const start = num(r.start);
    const end = num(r.end);
    const word = typeof r.word === "string" ? r.word : typeof r.text === "string" ? r.text : "";
    return start !== null && end !== null && word.trim() ? [{ start, end: Math.max(start, end), word: word.trim() }] : [];
  });
}

export interface ParsedTranscription {
  segments: TimedSegment[];
  /** Language reported by the service (normalized to a BCP 47 tag when recognized). */
  language: string | null;
  text: string;
}

/**
 * Read a `verbose_json` response. Words (top-level `words`, or per segment)
 * are attached to the segment they fall in. A plain `{ text }` response
 * (no timings) becomes one segment spanning `fallbackDuration`.
 */
export function parseTranscriptionResponse(body: unknown, fallbackDuration: number): ParsedTranscription {
  if (!body || typeof body !== "object") throw new Error("The transcription service returned an empty response.");
  const b = body as Record<string, unknown>;
  const text = typeof b.text === "string" ? b.text.trim() : "";
  const language = typeof b.language === "string" ? languageTag(b.language) : null;

  const words = parseWords(b.words);

  const segments: TimedSegment[] = Array.isArray(b.segments)
    ? (b.segments as unknown[]).flatMap((s) => {
        if (!s || typeof s !== "object") return [];
        const r = s as Record<string, unknown>;
        const start = num(r.start);
        const end = num(r.end);
        const segText = typeof r.text === "string" ? r.text.trim() : "";
        if (start === null || end === null || !segText) return [];
        // Whisper hallucinates on silence: drop segments it is almost sure contain no speech.
        const noSpeech = num(r.no_speech_prob);
        const avgLog = num(r.avg_logprob);
        if (noSpeech !== null && noSpeech > 0.8 && avgLog !== null && avgLog < -1) return [];
        const own = parseWords(r.words);
        return [{ start, end: Math.max(start, end), text: segText, ...(own.length ? { words: own } : {}) }];
      })
    : [];

  if (words.length && segments.length) {
    let w = 0;
    for (const seg of segments) {
      if (seg.words) continue;
      const mine: TimedWord[] = [];
      while (w < words.length && words[w]!.start < seg.end - 0.01) {
        if (words[w]!.start >= seg.start - 0.3) mine.push(words[w]!);
        w++;
      }
      if (mine.length) seg.words = mine;
    }
  }

  if (!segments.length) {
    if (words.length) {
      // Only word timings: treat the whole response as one segment with words.
      return { segments: [{ start: words[0]!.start, end: words[words.length - 1]!.end, text: words.map((x) => x.word).join(" "), words }], language, text };
    }
    if (text && fallbackDuration > 0) return { segments: [{ start: 0, end: fallbackDuration, text }], language, text };
  }
  return { segments, language, text };
}

const LANGUAGE_NAMES: Record<string, string> = {
  english: "en",
  hindi: "hi",
  arabic: "ar",
  spanish: "es",
  french: "fr",
  german: "de",
  italian: "it",
  portuguese: "pt",
  dutch: "nl",
  russian: "ru",
  ukrainian: "uk",
  polish: "pl",
  turkish: "tr",
  japanese: "ja",
  korean: "ko",
  chinese: "zh",
  mandarin: "zh",
  cantonese: "yue",
  vietnamese: "vi",
  indonesian: "id",
  malay: "ms",
  thai: "th",
  bengali: "bn",
  urdu: "ur",
  tamil: "ta",
  telugu: "te",
  marathi: "mr",
  gujarati: "gu",
  kannada: "kn",
  malayalam: "ml",
  punjabi: "pa",
  persian: "fa",
  hebrew: "he",
  greek: "el",
  swedish: "sv",
  norwegian: "no",
  danish: "da",
  finnish: "fi",
  czech: "cs",
  romanian: "ro",
  hungarian: "hu",
  swahili: "sw",
  tagalog: "tl",
  filipino: "fil",
};

/** "english" → "en", "EN" → "en", "pt-BR" stays; unknown names → null. */
export function languageTag(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  if (/^[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,8}){0,2}$/.test(v)) {
    const [primary, ...rest] = v.replace(/_/g, "-").split("-");
    return [primary!.toLowerCase(), ...rest.map((p) => (p.length === 2 ? p.toUpperCase() : p))].join("-");
  }
  return LANGUAGE_NAMES[v.toLowerCase()] ?? null;
}

/** Primary subtag sent as the `language` hint ("pt-BR" → "pt"). */
export function languageHint(tag: string | undefined | null): string | null {
  const primary = tag?.split("-")[0]?.toLowerCase();
  return primary && /^[a-z]{2,3}$/.test(primary) ? primary : null;
}

/** Last words of a part, sent as the `prompt` of the next one for continuity. */
export function continuityPrompt(segments: readonly TimedSegment[], maxChars = 200): string {
  const text = segments
    .map((s) => s.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= maxChars) return text;
  const tail = text.slice(-maxChars);
  const space = tail.indexOf(" ");
  return space >= 0 ? tail.slice(space + 1) : tail;
}

/** Seconds to wait before retrying: `Retry-After` (seconds or HTTP date) when given, else exponential. */
export function retryAfterMs(header: string | null, attempt: number, now = Date.now()): number {
  if (header) {
    const secs = Number(header);
    if (Number.isFinite(secs) && secs >= 0) return Math.min(60_000, secs * 1000);
    const at = Date.parse(header);
    if (Number.isFinite(at)) return Math.min(60_000, Math.max(0, at - now));
  }
  return Math.min(30_000, 2000 * 2 ** attempt);
}

/** Readable error from an API error body without echoing anything secret. */
export function apiErrorMessage(status: number, body: string): string {
  let detail = "";
  try {
    const parsed = JSON.parse(body) as { error?: { message?: unknown } | string; message?: unknown };
    const e = parsed.error;
    detail = typeof e === "string" ? e : typeof e?.message === "string" ? e.message : typeof parsed.message === "string" ? parsed.message : "";
  } catch {
    detail = body.replace(/<[^>]*>/g, " ");
  }
  detail = detail
    .replace(/\b(sk|key|token)[-_][A-Za-z0-9_-]{8,}/gi, "[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
  const base =
    status === 401 || status === 403
      ? "The transcription service rejected the API key."
      : status === 413
        ? "An audio part was too large for the transcription service."
        : status === 429
          ? "The transcription service is rate limiting requests."
          : `The transcription service answered HTTP ${status}.`;
  return detail ? `${base} ${detail}` : base;
}

/**
 * Whether a video URL outside the upload store may be handed to ffmpeg:
 * http(s) only, and never a loopback, private, link-local or internal host
 * (the server must not be used to reach its own network).
 */
export function isPublicMediaUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  if (url.username || url.password) return false;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || /\.(localhost|local|internal|lan|home|corp)$/.test(host) || (!host.includes(".") && !host.includes(":"))) return false;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    return true;
  }
  if (host.includes(":")) {
    if (host === "::" || host === "::1" || /^f[cd]/.test(host) || /^fe[89ab]/.test(host) || host.startsWith("::ffff:")) return false;
  }
  // Numeric forms browsers accept but people rarely mean ("2130706433", "0x7f.1").
  if (/^[0-9.]+$/.test(host) || /^0x/i.test(host)) return false;
  return true;
}
