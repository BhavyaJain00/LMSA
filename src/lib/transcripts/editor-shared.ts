import type { Transcript, TranscriptCue } from "@/lib/types";

/**
 * Types shared by the transcript editor (client), its server actions and
 * the status route. Pure: safe to import from client components.
 */

/** A cue on the wire: `[start, end, text]`. */
export type CueTuple = [number, number, string];

/** What the editor needs of a stored transcript. */
export interface EditorTranscript {
  id: string;
  language: string;
  source: Transcript["source"];
  status: Transcript["status"];
  error: string | null;
  updatedAt: string;
  cues: TranscriptCue[];
}

export function toEditorTranscript(t: Transcript): EditorTranscript {
  return { id: t.id, language: t.language, source: t.source, status: t.status, error: t.error ?? null, updatedAt: t.updatedAt, cues: t.cues };
}

export function cuesToTuples(cues: readonly TranscriptCue[]): CueTuple[] {
  return cues.map((c) => [c.start, c.end, c.text]);
}

/** BCP 47 tag accepted for a transcript language ("en", "pt-BR", "zh-Hant-TW"). */
export const LANGUAGE_PATTERN = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,2}$/;

/** Server Actions accept request bodies up to 1 MB by default; leave room for the rest of the payload. */
export const MAX_SAVE_BYTES = 950_000;

/** Size of a save payload in bytes (UTF-8), to warn before sending one that is too large. */
export function savePayloadBytes(cues: readonly TranscriptCue[]): number {
  return new TextEncoder().encode(JSON.stringify(cuesToTuples(cues))).length;
}

export const SOURCE_LABELS: Record<Transcript["source"], string> = {
  auto: "Generated automatically",
  upload: "Imported from a caption file",
  manual: "Edited by hand",
};

/** Languages offered in the editor (any BCP 47 tag can be typed). */
export const COMMON_LANGUAGES: { code: string; label: string }[] = [
  { code: "en", label: "English" },
  { code: "hi", label: "Hindi" },
  { code: "ar", label: "Arabic" },
  { code: "es", label: "Spanish" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "pt", label: "Portuguese" },
  { code: "it", label: "Italian" },
  { code: "ja", label: "Japanese" },
  { code: "zh", label: "Chinese" },
  { code: "ru", label: "Russian" },
  { code: "bn", label: "Bengali" },
  { code: "ta", label: "Tamil" },
  { code: "te", label: "Telugu" },
  { code: "mr", label: "Marathi" },
  { code: "ur", label: "Urdu" },
];

/** Display name of a language tag ("en" → "English"), falling back to the tag. */
export function languageLabel(tag: string): string {
  const primary = tag.split("-")[0]?.toLowerCase() ?? tag;
  const known = COMMON_LANGUAGES.find((l) => l.code === primary);
  if (known) return tag.includes("-") ? `${known.label} (${tag})` : known.label;
  try {
    const name = new Intl.DisplayNames(["en"], { type: "language" }).of(tag);
    if (name && name !== tag) return name;
  } catch {
    /* unknown tag */
  }
  return tag;
}
