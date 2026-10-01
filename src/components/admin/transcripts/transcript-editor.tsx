"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { TranscriptCue } from "@/lib/types";
import { cancelTranscriptGenerationAction, deleteTranscriptAction, generateTranscriptAction, saveTranscriptAction } from "@/lib/actions/transcripts";
import { cueIndexAt, cueIssues, insertCueAfter, mergeWithNext, normalizeCues, sameCues, shiftCues, splitCue } from "@/lib/transcripts/cues";
import { serializeTranscript, transcriptFileName, type TranscriptFormat } from "@/lib/transcripts/format";
import {
  COMMON_LANGUAGES,
  LANGUAGE_PATTERN,
  MAX_SAVE_BYTES,
  SOURCE_LABELS,
  cuesToTuples,
  languageLabel,
  savePayloadBytes,
  type EditorTranscript,
} from "@/lib/transcripts/editor-shared";
import {
  clampPage,
  closeSmallGaps,
  combineImported,
  commitCues,
  formatTimeInput,
  initHistory,
  insertCueAt,
  isConsecutive,
  issuesByCue,
  mergeRange,
  pageCount,
  pageOfPosition,
  PAGE_SIZE,
  redoCues,
  removeCues,
  scaleCues,
  setCueText,
  setCueTimes,
  summarizeCues,
  undoCues,
  visibleCueIndices,
  type CueFilter,
  type CueHistory,
} from "@/lib/transcripts/editor-state";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Dropdown } from "@/components/ui/dropdown";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/skeleton";
import { SegmentedControl } from "@/components/ui/tabs";
import { Icon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import { cn, relativeTime } from "@/lib/utils";
import { CueList } from "./cue-list";
import type { CueRowHandlers } from "./cue-row";
import { GeneratePanel, type GenerationAvailability, type GenerationJob } from "./generate-panel";
import { ImportDialog, type ImportRequest } from "./import-dialog";
import { PreviewPlayer, type PreviewVideo } from "./preview-player";
import { ShiftDialog, type TimingChange } from "./shift-dialog";

/** How often the generation status is checked while a job is queued or running. */
const STATUS_POLL_MS = 3000;
/** Seconds the J / L shortcuts jump. */
const JUMP_SECONDS = 3;

interface StatusBody {
  ok: boolean;
  error?: string;
  job: GenerationJob | null;
  transcript: EditorTranscript | null;
}

export interface TranscriptEditorProps {
  lessonId: string;
  lessonTitle: string;
  video: PreviewVideo;
  initial: EditorTranscript | null;
  initialJob: GenerationJob | null;
  availability: GenerationAvailability;
  /** Storage & video settings (admins only). */
  settingsHref: string | null;
}

/**
 * Transcript editor of one lesson video: a synced preview, a paginated and
 * searchable caption table with inline editing, split / merge / insert /
 * delete, bulk actions, timing shifts, VTT/SRT import and export, undo/redo,
 * automatic generation with live status, and saving with conflict detection.
 */
export function TranscriptEditor({ lessonId, lessonTitle, video, initial, initialJob, availability, settingsHref }: TranscriptEditorProps) {
  const router = useRouter();
  const toast = useToast();
  const uid = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  /* ------------------------------ state ------------------------------ */
  const [base, setBase] = useState<EditorTranscript | null>(initial);
  const [history, setHistory] = useState<CueHistory>(() => initHistory(initial?.cues ?? []));
  const [language, setLanguage] = useState(initial?.language ?? "en");
  const [imported, setImported] = useState<TranscriptCue[] | null>(null);
  const [selection, setSelection] = useState<number[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<CueFilter>("all");
  const [page, setPage] = useState(0);
  const [follow, setFollow] = useState(true);
  const [playhead, setPlayhead] = useState(0);
  const [seek, setSeek] = useState<{ time: number; key: number; play?: boolean } | undefined>(undefined);
  const [job, setJob] = useState<GenerationJob | null>(initialJob);
  const [generation, setGeneration] = useState<"start" | "cancel" | null>(null);
  const [saving, startSaving] = useTransition();
  const [deleting, startDeleting] = useTransition();
  const [saveError, setSaveError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [incoming, setIncoming] = useState<EditorTranscript | null>(null);
  const [dialog, setDialog] = useState<"import" | "shift" | "delete" | "discard" | null>(null);
  const [reveal, setReveal] = useState<{ index: number; focus: boolean; key: number } | null>(null);

  const cues = history.present;
  const baseCues = useMemo(() => base?.cues ?? [], [base]);
  const baseLanguage = base?.language ?? "en";
  const dirty = !sameCues(cues, baseCues) || language.trim() !== baseLanguage;
  const languageValid = LANGUAGE_PATTERN.test(language.trim());
  const origin: "manual" | "upload" = imported && sameCues(cues, imported) ? "upload" : "manual";

  const issues = useMemo(() => cueIssues(cues), [cues]);
  const issueMap = useMemo(() => issuesByCue(issues), [issues]);
  const summary = useMemo(() => summarizeCues(cues, issues), [cues, issues]);
  const visible = useMemo(() => visibleCueIndices(cues, query, filter, issues), [cues, query, filter, issues]);
  const pages = pageCount(visible.length);
  const currentPage = clampPage(page, visible.length);
  const pageIndices = useMemo(() => visible.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE), [visible, currentPage]);
  const selectedSet = useMemo(() => new Set(selection), [selection]);
  const activeIndex = useMemo(() => cueIndexAt(cues, playhead), [cues, playhead]);

  // Latest values for stable callbacks and listeners.
  const cuesRef = useRef(cues);
  const timeRef = useRef(0);
  const dirtyRef = useRef(dirty);
  const baseRef = useRef(base);
  const visibleRef = useRef(visible);
  const followRef = useRef(follow);
  const anchorRef = useRef<number | null>(null);
  useLayoutEffect(() => {
    cuesRef.current = cues;
    dirtyRef.current = dirty;
    baseRef.current = base;
    visibleRef.current = visible;
    followRef.current = follow;
  });

  /* ---------------------------- editing ----------------------------- */
  const commit = useCallback((next: TranscriptCue[] | ((prev: TranscriptCue[]) => TranscriptCue[]), key: string | null = null, keepSelection = false) => {
    setHistory((h) => commitCues(h, typeof next === "function" ? next(h.present) : next, key));
    if (!keepSelection) setSelection([]);
    setSaveError(null);
  }, []);

  const undo = useCallback(() => {
    setHistory((h) => undoCues(h));
    setSelection([]);
  }, []);
  const redo = useCallback(() => {
    setHistory((h) => redoCues(h));
    setSelection([]);
  }, []);

  /** Show caption `index` (switching page, clearing filters that hide it), optionally focusing its text. */
  const revealCue = useCallback((index: number, focus: boolean) => {
    let position = visibleRef.current.indexOf(index);
    if (position < 0) {
      setQuery("");
      setFilter("all");
      position = index;
    }
    setPage(pageOfPosition(position));
    setReveal((r) => ({ index, focus, key: (r?.key ?? 0) + 1 }));
  }, []);

  useEffect(() => {
    if (!reveal) return;
    const row = listRef.current?.querySelector<HTMLElement>(`[data-cue-row="${reveal.index}"]`);
    if (!row) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    row.scrollIntoView({ block: reveal.focus ? "center" : "nearest", behavior: reduce ? "auto" : "smooth" });
    if (reveal.focus) row.querySelector<HTMLTextAreaElement>("textarea")?.focus({ preventScroll: true });
  }, [reveal, pageIndices]);

  const seekTo = useCallback((time: number, play = true) => {
    setSeek((s) => ({ time, key: (s?.key ?? 0) + 1, play }));
  }, []);

  const handlers = useMemo<CueRowHandlers>(
    () => ({
      onSelect: (index, selected, range) => {
        setSelection((prev) => {
          const set = new Set(prev);
          if (range && anchorRef.current !== null) {
            const [a, b] = [Math.min(anchorRef.current, index), Math.max(anchorRef.current, index)];
            for (let i = a; i <= b; i++) set.add(i);
          } else if (selected) set.add(index);
          else set.delete(index);
          return [...set].sort((x, y) => x - y);
        });
        anchorRef.current = index;
      },
      onText: (index, text) => commit((c) => setCueText(c, index, text), `text:${index}`, true),
      onTimes: (index, times) => {
        const result = setCueTimes(cuesRef.current, index, times);
        if (!result.ok) return result.error;
        commit(result.cues, null, result.index === index);
        return null;
      },
      onPlay: (index) => {
        const cue = cuesRef.current[index];
        if (cue) seekTo(cue.start, true);
      },
      onSplit: (index, textOffset) => {
        const cue = cuesRef.current[index];
        if (!cue) return;
        const t = timeRef.current;
        const at = t > cue.start && t < cue.end ? t : undefined;
        const next = splitCue(cuesRef.current, index, { at, textOffset });
        if (next.length === cuesRef.current.length) {
          toast.error("This caption can't be split", "It needs at least two words and a fifth of a second.");
          return;
        }
        commit(next);
        revealCue(index + 1, true);
      },
      onMerge: (index) => {
        if (index >= cuesRef.current.length - 1) return;
        commit((c) => mergeWithNext(c, index));
        revealCue(index, true);
      },
      onInsertAfter: (index) => {
        commit((c) => insertCueAfter(c, index, ""));
        revealCue(index + 1, true);
      },
      onDelete: (index) => {
        commit((c) => removeCues(c, [index]));
        toast.toast({ title: `Caption ${index + 1} deleted`, tone: "neutral", action: { label: "Undo", onClick: undo } });
      },
      onStamp: (index, edge) => {
        const result = setCueTimes(cuesRef.current, index, { [edge]: timeRef.current });
        if (!result.ok) {
          toast.error(edge === "start" ? "The playhead is past this caption's end" : "The playhead is before this caption's start", "Move the video, then try again.");
          return;
        }
        commit(result.cues, null, result.index === index);
      },
      onFocusMove: (index) => {
        if (index < 0 || index >= cuesRef.current.length) return;
        revealCue(index, true);
      },
    }),
    [commit, revealCue, seekTo, toast, undo],
  );
  const addAtPlayhead = () => {
    const { cues: next, index } = insertCueAt(cuesRef.current, timeRef.current, "");
    commit(next);
    revealCue(index, true);
  };

  /* ---------------------------- playhead ---------------------------- */
  const onTick = useCallback((time: number) => {
    timeRef.current = time;
    setPlayhead(time);
  }, []);

  // Follow the video: bring the caption being shown into view, unless the editor is typing in the list or it is filtered out.
  const lastFollowed = useRef(-1);
  useEffect(() => {
    if (activeIndex === lastFollowed.current) return;
    lastFollowed.current = activeIndex;
    if (activeIndex < 0 || !followRef.current || listRef.current?.contains(document.activeElement)) return;
    if (visibleRef.current.includes(activeIndex)) revealCue(activeIndex, false);
  }, [activeIndex, revealCue]);

  /* ------------------------- bulk and tools ------------------------- */
  const selectionConsecutive = isConsecutive(selection);
  const pageAllSelected = pageIndices.length > 0 && pageIndices.every((i) => selectedSet.has(i));

  const togglePageSelection = () => {
    setSelection((prev) => {
      const set = new Set(prev);
      for (const i of pageIndices) {
        if (pageAllSelected) set.delete(i);
        else set.add(i);
      }
      return [...set].sort((a, b) => a - b);
    });
  };

  const deleteSelected = () => {
    const count = selection.length;
    commit((c) => removeCues(c, selection));
    toast.toast({ title: `${count} ${count === 1 ? "caption" : "captions"} deleted`, tone: "neutral", action: { label: "Undo", onClick: undo } });
  };

  const mergeSelected = () => {
    if (!selectionConsecutive) return;
    const first = selection[0]!;
    commit((c) => mergeRange(c, first, selection[selection.length - 1]!));
    revealCue(first, true);
  };

  const applyTiming = (change: TimingChange) => {
    if (change.kind === "shift") commit((c) => shiftCues(c, change.offset, { from: change.from, to: change.to }));
    else commit((c) => scaleCues(c, change.factor));
    setDialog(null);
    toast.success(change.kind === "shift" ? `Captions moved ${change.offset > 0 ? "later" : "earlier"} by ${formatTimeInput(Math.abs(change.offset))}` : "Captions stretched to the new frame rate");
  };

  const tidyGaps = () => {
    const next = closeSmallGaps(cuesRef.current);
    if (sameCues(next, cuesRef.current)) {
      toast.toast({ title: "Nothing to tidy", description: "No short gaps or overlaps between captions.", tone: "info" });
      return;
    }
    commit(next);
    toast.success("Short gaps closed and overlaps trimmed");
  };

  const applyImport = (req: ImportRequest) => {
    const { cues: next, dropped } = combineImported(cuesRef.current, req.cues, req.mode, req.offset);
    commit(next);
    setImported(req.mode === "replace" && !req.offset ? next : null);
    setDialog(null);
    setPage(0);
    toast.success(`Imported ${req.cues.length.toLocaleString("en-US")} captions from ${req.fileName}`, dropped ? `${dropped} did not fit the ${next.length.toLocaleString("en-US")}-caption limit.` : "Review them, then save.");
  };

  const download = (format: TranscriptFormat) => {
    const clean = normalizeCues(cuesRef.current);
    if (!clean.length) {
      toast.error("Nothing to export", "Add captions with text first.");
      return;
    }
    const body = serializeTranscript(clean, format, { language: language.trim(), title: lessonTitle });
    const url = URL.createObjectURL(new Blob([body], { type: format === "vtt" ? "text/vtt" : format === "srt" ? "application/x-subrip" : "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = transcriptFileName(lessonTitle, format);
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  /* ------------------------------ saving ----------------------------- */
  const loadVersion = useCallback((t: EditorTranscript | null, keepHistory = true) => {
    setBase(t);
    setHistory((h) => (keepHistory ? commitCues(h, t?.cues ?? []) : initHistory(t?.cues ?? [])));
    setLanguage(t?.language ?? "en");
    setImported(null);
    setSelection([]);
    setIncoming(null);
    setConflict(false);
    setSaveError(null);
  }, []);

  const fetchStatus = useCallback(async (): Promise<StatusBody | null> => {
    try {
      const res = await fetch(`/api/transcripts/${encodeURIComponent(lessonId)}/${encodeURIComponent(video.id)}/status`, {
        credentials: "same-origin",
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      const body = (await res.json()) as StatusBody;
      return body.ok ? body : null;
    } catch {
      return null;
    }
  }, [lessonId, video.id]);

  const save = (baseOverride?: string | null) => {
    if (saving) return;
    if (job) {
      setSaveError("A transcript is being generated for this video. Wait for it to finish or cancel it, then save.");
      return;
    }
    if (!languageValid) {
      setSaveError("Enter a language code such as en, hi or pt-BR.");
      return;
    }
    const clean = normalizeCues(cuesRef.current);
    if (!clean.length) {
      setSaveError("Add at least one caption with text, or delete the transcript instead.");
      return;
    }
    if (savePayloadBytes(clean) > MAX_SAVE_BYTES) {
      setSaveError("This transcript is too large to save in one go. Shorten or merge captions, or split the video into several lessons.");
      return;
    }
    const baseUpdatedAt = baseOverride !== undefined ? baseOverride : (baseRef.current?.updatedAt ?? null);
    startSaving(async () => {
      const res = await saveTranscriptAction({ lessonId, blockId: video.id, language: language.trim(), cues: cuesToTuples(clean), baseUpdatedAt, origin });
      if (!res.ok) {
        setSaveError(res.error);
        setConflict(!!res.fieldErrors?.conflict);
        return;
      }
      setBase(res.data.transcript);
      setHistory((h) => commitCues(h, res.data.transcript.cues));
      setLanguage(res.data.transcript.language);
      setImported(null);
      setConflict(false);
      setIncoming(null);
      setSaveError(null);
      toast.success(res.message ?? "Transcript saved");
      router.refresh();
    });
  };
  const saveRef = useRef(save);
  useLayoutEffect(() => {
    saveRef.current = save;
  });

  const resolveConflict = async (keepMine: boolean) => {
    const status = await fetchStatus();
    if (!status) {
      setSaveError("The latest version could not be loaded. Check your connection and try again.");
      return;
    }
    if (status.job) setJob(status.job);
    if (keepMine) {
      setBase(status.transcript);
      saveRef.current(status.transcript?.updatedAt ?? null);
    } else {
      loadVersion(status.transcript);
      toast.success("Latest version loaded");
    }
  };

  const discard = () => {
    loadVersion(baseRef.current);
    setDialog(null);
  };

  const removeTranscript = () => {
    startDeleting(async () => {
      const res = await deleteTranscriptAction(lessonId, video.id);
      setDialog(null);
      if (!res.ok) {
        toast.error("Couldn't delete the transcript", res.error);
        return;
      }
      setJob(null);
      loadVersion(null, false);
      toast.success(res.message ?? "Transcript deleted");
      router.refresh();
    });
  };

  /* --------------------------- generation --------------------------- */
  const generate = async (hint: string | null) => {
    setGeneration("start");
    try {
      const res = await generateTranscriptAction(lessonId, video.id, hint);
      if (!res.ok) {
        toast.error("Couldn't start generation", res.error);
        return;
      }
      setJob(res.data.job);
      const t = res.data.transcript;
      // The stored row was touched (error cleared or a placeholder created); keep the editor's cues.
      if (t) setBase((b) => (b && sameCues(b.cues, t.cues) ? t : (b ?? t)));
      toast.success("Generation started", res.message);
    } finally {
      setGeneration(null);
    }
  };

  const cancelGeneration = async () => {
    setGeneration("cancel");
    try {
      const res = await cancelTranscriptGenerationAction(lessonId, video.id);
      if (!res.ok) toast.error("Couldn't cancel", res.error);
      else toast.toast({ title: res.message ?? "Generation cancelled", tone: "info" });
    } finally {
      setGeneration(null);
    }
  };

  // Poll while a job is queued or running; take in its result when it ends.
  const jobActive = !!job;
  useEffect(() => {
    if (!jobActive) return;
    let stopped = false;
    let timer: number | undefined;
    const tick = async () => {
      if (document.visibilityState === "visible") {
        const status = await fetchStatus();
        if (stopped) return;
        if (status) {
          setJob(status.job);
          if (!status.job) {
            const t = status.transcript;
            const current = baseRef.current;
            if (t && current && sameCues(t.cues, current.cues)) {
              // Same captions (cancelled, or failed with earlier ones kept): just take the new version stamp and error.
              setBase(t);
              if (t.error) toast.toast({ title: "No new transcript", description: t.error, tone: "warning", duration: 8000 });
            } else if (t && t.cues.length && t.status === "ready") {
              if (dirtyRef.current) setIncoming(t);
              else {
                loadVersion(t);
                toast.success("Transcript generated", `${t.cues.length.toLocaleString("en-US")} captions. Review them against the video.`);
              }
            } else {
              setBase(t);
              if (t?.error) toast.error("Transcript generation failed", t.error);
            }
            router.refresh();
            return;
          }
        }
      }
      timer = window.setTimeout(() => void tick(), STATUS_POLL_MS);
    };
    timer = window.setTimeout(() => void tick(), STATUS_POLL_MS);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [jobActive, fetchStatus, loadVersion, router, toast]);

  /* ---------------------------- keyboard ---------------------------- */
  const addAtPlayheadRef = useRef(addAtPlayhead);
  useLayoutEffect(() => {
    addAtPlayheadRef.current = addAtPlayhead;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const target = e.target as HTMLElement | null;
      const inCues = !!target?.closest("[data-transcript-cues]");
      const inOtherField = !inCues && !!target?.closest("input, textarea, select, [contenteditable]");
      if (mod && !e.altKey && e.code === "KeyS") {
        e.preventDefault();
        saveRef.current();
        return;
      }
      if (mod && !e.altKey && !inOtherField && (e.code === "KeyZ" || e.code === "KeyY")) {
        e.preventDefault();
        if (e.code === "KeyY" || e.shiftKey) redo();
        else undo();
        return;
      }
      if (e.altKey && !mod) {
        const el = rootRef.current?.querySelector<HTMLVideoElement>("video[data-ll-main-video]");
        if (e.code === "KeyK" && el) {
          e.preventDefault();
          if (el.paused) void el.play().catch(() => undefined);
          else el.pause();
        } else if ((e.code === "KeyJ" || e.code === "KeyL") && el) {
          e.preventDefault();
          seekTo(Math.max(0, timeRef.current + (e.code === "KeyJ" ? -JUMP_SECONDS : JUMP_SECONDS)), !el.paused);
        } else if (e.code === "BracketLeft" || e.code === "BracketRight") {
          const row = target?.closest<HTMLElement>("[data-cue-row]");
          if (!row) return;
          e.preventDefault();
          handlers.onStamp(Number(row.dataset.cueRow), e.code === "BracketLeft" ? "start" : "end");
        } else if (e.code === "KeyN") {
          e.preventDefault();
          addAtPlayheadRef.current();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [handlers, redo, seekTo, undo]);
  // Warn before leaving with unsaved edits.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  /* ------------------------------ render ----------------------------- */
  const languageListId = `${uid}-languages`;
  const status = base ? (base.status === "processing" && !job ? "failed" : base.status) : null;

  return (
    <div ref={rootRef} className="pb-24">
      {conflict && (
        <div role="alert" className="mb-4 flex flex-col gap-3 rounded-card border border-danger/30 bg-danger/10 p-4 text-sm sm:flex-row sm:items-center sm:justify-between">
          <p className="flex gap-2 text-ink">
            <Icon.AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" />
            <span>Someone else saved this transcript (or an automatic one finished) after you opened it. Choose which version to keep.</span>
          </p>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => void resolveConflict(false)}>
              Load their version
            </Button>
            <Button size="sm" variant="danger" onClick={() => void resolveConflict(true)} loading={saving}>
              Keep mine and save
            </Button>
          </div>
        </div>
      )}

      {incoming && (
        <div role="status" className="mb-4 flex flex-col gap-3 rounded-card border border-info/30 bg-info/10 p-4 text-sm sm:flex-row sm:items-center sm:justify-between">
          <p className="flex gap-2 text-ink">
            <Icon.Sparkles className="mt-0.5 size-4 shrink-0 text-info" />
            <span>
              A generated transcript with {incoming.cues.length.toLocaleString("en-US")} captions is ready. Loading it replaces your unsaved edits (you can undo).
            </span>
          </p>
          <div className="flex shrink-0 gap-2">
            <Button size="sm" variant="ghost" onClick={() => {
              setBase(incoming);
              setIncoming(null);
            }}>
              Keep editing mine
            </Button>
            <Button size="sm" onClick={() => loadVersion(incoming)}>
              Load it
            </Button>
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)] xl:grid-cols-[minmax(0,30rem)_minmax(0,1fr)]">
        <aside className="space-y-4 lg:sticky lg:top-20 lg:max-h-[calc(100dvh-6rem)] lg:self-start lg:overflow-y-auto lg:pb-2">
          <PreviewPlayer lessonId={lessonId} video={video} cues={cues} language={languageValid ? language.trim() : baseLanguage} seekRequest={seek} onTick={onTick} onJumpToCue={(i) => revealCue(i, true)} />

          <section aria-label="Transcript details" className="rounded-card border border-border bg-surface-1 p-4">
            <div className="flex flex-wrap items-center gap-2">
              {base && status ? (
                <>
                  <Badge tone={status === "ready" ? "success" : status === "failed" ? "danger" : "info"}>
                    {status === "ready" ? "Published to learners" : status === "failed" ? "Not available to learners" : "Being generated"}
                  </Badge>
                  <span className="text-xs text-ink-muted">
                    {SOURCE_LABELS[base.source]} · saved {relativeTime(base.updatedAt)}
                  </span>
                </>
              ) : (
                <Badge tone="neutral">Not saved yet</Badge>
              )}
            </div>
            <div className="mt-3">
              <label htmlFor={`${uid}-language`} className="mb-1 block text-xs font-medium text-ink-muted">
                Language of the captions
              </label>
              <div className="flex items-center gap-2">
                <Input
                  id={`${uid}-language`}
                  list={languageListId}
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  invalid={!languageValid}
                  autoComplete="off"
                  spellCheck={false}
                  className="max-w-36 font-mono"
                  aria-describedby={`${uid}-language-hint`}
                />
                <span id={`${uid}-language-hint`} className={cn("min-w-0 truncate text-xs", languageValid ? "text-ink-muted" : "text-danger")}>
                  {languageValid ? languageLabel(language.trim()) : "Use a code such as en, hi or pt-BR"}
                </span>
              </div>
              <datalist id={languageListId}>
                {COMMON_LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.label}
                  </option>
                ))}
              </datalist>
            </div>
            {base && (
              <div className="mt-3 border-t border-border pt-3">
                <Button variant="ghost" size="sm" className="-ml-2 text-danger" leftIcon={<Icon.Trash className="size-4" />} onClick={() => setDialog("delete")}>
                  Delete transcript
                </Button>
              </div>
            )}
          </section>

          <GeneratePanel
            availability={availability}
            job={job}
            lastError={base?.error ?? null}
            hasCues={cues.length > 0 || baseCues.length > 0}
            dirty={dirty}
            defaultLanguage={base?.language ?? ""}
            settingsHref={settingsHref}
            pending={generation}
            onGenerate={(hint) => void generate(hint)}
            onCancel={() => void cancelGeneration()}
          />

          <details className="rounded-card border border-border bg-surface-1 p-4 text-xs text-ink-muted">
            <summary className="cursor-pointer text-sm font-medium text-ink">Keyboard shortcuts</summary>
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
              {[
                ["Ctrl+S", "Save"],
                ["Ctrl+Z / Ctrl+Shift+Z", "Undo / redo"],
                ["Alt+K", "Play or pause the preview"],
                ["Alt+J / Alt+L", `Back / forward ${JUMP_SECONDS} seconds`],
                ["Alt+N", "New caption at the playhead"],
                ["Alt+[ / Alt+]", "Start / end the focused caption at the playhead"],
                ["Ctrl+Enter", "Split the caption at the cursor"],
                ["Alt+↑ / Alt+↓", "Previous / next caption"],
                ["↑ / ↓ in a time", "Nudge by 0.1 s (Shift: 1 s)"],
              ].map(([keys, what]) => (
                <div key={keys} className="contents">
                  <dt>
                    <kbd className="rounded border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-ink">{keys}</kbd>
                  </dt>
                  <dd className="self-center">{what}</dd>
                </div>
              ))}
            </dl>
          </details>
        </aside>

        <section aria-labelledby={`${uid}-captions`} className="min-w-0 rounded-card border border-border bg-surface-1">
          <header className="space-y-3 border-b border-border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <h2 id={`${uid}-captions`} className="text-base font-semibold text-ink">
                  Captions
                </h2>
                <p className="text-xs text-ink-muted tabular-nums">
                  {summary.count.toLocaleString("en-US")} {summary.count === 1 ? "caption" : "captions"} · {summary.words.toLocaleString("en-US")} words
                  {summary.count > 0 && <> · ends at {formatTimeInput(summary.end)}</>}
                  {summary.issues > 0 && <span className="text-warning"> · {summary.issues} to check</span>}
                  {summary.empty > 0 && <span className="text-danger"> · {summary.empty} empty</span>}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <Button size="sm" variant="ghost" onClick={undo} disabled={!history.past.length} aria-label="Undo" title="Undo (Ctrl+Z)">
                  <Icon.ArrowLeft className="size-4" />
                </Button>
                <Button size="sm" variant="ghost" onClick={redo} disabled={!history.future.length} aria-label="Redo" title="Redo (Ctrl+Shift+Z)">
                  <Icon.ArrowRight className="size-4" />
                </Button>
                <Button size="sm" variant="outline" onClick={addAtPlayhead} leftIcon={<Icon.Plus className="size-4" />} title="New caption at the playhead (Alt+N)">
                  Add
                </Button>
                <Button size="sm" variant="outline" onClick={() => setDialog("import")} leftIcon={<Icon.Upload className="size-4" />}>
                  Import
                </Button>
                <Dropdown
                  trigger={<span className={cn("inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-sm font-medium text-ink hover:bg-surface-2")}><Icon.Download className="size-4" /> Export</span>}
                  header={dirty ? <span className="text-xs text-ink-muted">Includes unsaved edits</span> : undefined}
                  items={[
                    { label: "WebVTT (.vtt)", onClick: () => download("vtt"), description: "Web players and most platforms" },
                    { label: "SubRip (.srt)", onClick: () => download("srt"), description: "Video editors and desktop players" },
                    { label: "Plain text (.txt)", onClick: () => download("txt"), description: "Readable transcript with timestamps" },
                  ]}
                />
                <Dropdown
                  trigger={
                    <span className="inline-flex size-8 items-center justify-center rounded-lg border border-border text-ink hover:bg-surface-2">
                      <Icon.MoreHorizontal className="size-4" />
                      <span className="sr-only">More caption tools</span>
                    </span>
                  }
                  items={[
                    { label: "Adjust timing…", icon: <Icon.Timer className="size-4" />, onClick: () => setDialog("shift"), disabled: !cues.length },
                    { label: "Close short gaps", icon: <Icon.Sliders className="size-4" />, onClick: tidyGaps, disabled: cues.length < 2, description: "Join captions less than half a second apart" },
                    { label: "Discard unsaved changes", icon: <Icon.Refresh className="size-4" />, onClick: () => setDialog("discard"), disabled: !dirty, destructive: true, separator: true },
                  ]}
                />
              </div>
            </div>

            {cues.length > 0 && (
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <Input
                    type="search"
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      setPage(0);
                    }}
                    placeholder="Find in captions"
                    aria-label="Find in captions"
                    leftAddon={<Icon.Search className="size-4" />}
                  />
                </div>
                <div className="flex items-center justify-between gap-2">
                  <SegmentedControl
                    value={filter}
                    onChange={(v) => {
                      setFilter(v);
                      setPage(0);
                    }}
                    options={[
                      { value: "all", label: "All" },
                      { value: "issues", label: `To check${summary.issues ? ` (${summary.issues})` : ""}` },
                      { value: "empty", label: `Empty${summary.empty ? ` (${summary.empty})` : ""}` },
                    ]}
                  />
                  <label className="inline-flex items-center gap-1.5 text-xs text-ink-muted">
                    <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} className="size-3.5 accent-(--accent)" />
                    Follow video
                  </label>
                </div>
              </div>
            )}

            {selection.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 rounded-lg bg-info/10 px-3 py-2 text-sm" role="region" aria-label="Selected captions">
                <span className="font-medium text-ink">{selection.length} selected</span>
                <Button size="xs" variant="outline" onClick={mergeSelected} disabled={!selectionConsecutive} title={selectionConsecutive ? undefined : "Select captions next to each other to merge them"}>
                  Merge
                </Button>
                <Button size="xs" variant="outline" onClick={() => setDialog("shift")}>
                  Adjust timing
                </Button>
                <Button size="xs" variant="outline" className="text-danger" onClick={deleteSelected} leftIcon={<Icon.Trash className="size-3.5" />}>
                  Delete
                </Button>
                <Button size="xs" variant="ghost" onClick={() => setSelection([])} className="ml-auto">
                  Clear
                </Button>
              </div>
            )}
          </header>

          <div ref={listRef} data-transcript-cues>
            {cues.length === 0 ? (
              <EmptyState
                className="m-4 border-none"
                icon={<Icon.Captions />}
                title={job ? "A transcript is being generated" : "No captions yet"}
                description={
                  job
                    ? "The captions appear here when generation finishes. You can also start writing them yourself."
                    : "Write them as you watch the preview, import a .vtt or .srt file, or generate them automatically from the audio."
                }
                action={
                  <div className="flex flex-wrap justify-center gap-2">
                    <Button onClick={addAtPlayhead} leftIcon={<Icon.Plus className="size-4" />}>
                      Add the first caption
                    </Button>
                    <Button variant="outline" onClick={() => setDialog("import")} leftIcon={<Icon.Upload className="size-4" />}>
                      Import a file
                    </Button>
                  </div>
                }
              />
            ) : visible.length === 0 ? (
              <EmptyState
                compact
                className="m-4"
                icon={<Icon.Search />}
                title="No captions match"
                description={query.trim() ? `Nothing contains “${query.trim()}”${filter !== "all" ? " in this filter" : ""}.` : filter === "issues" ? "No caption needs checking." : "No caption is empty."}
                action={
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setQuery("");
                      setFilter("all");
                    }}
                  >
                    Show all captions
                  </Button>
                }
              />
            ) : (
              <>
                <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-xs text-ink-muted">
                  <input type="checkbox" checked={pageAllSelected} onChange={togglePageSelection} aria-label="Select every caption on this page" className="size-4 accent-(--accent)" />
                  <span className="hidden w-[6.75rem] sm:ml-5 sm:block">Start</span>
                  <span className="hidden w-[6.75rem] sm:block">End</span>
                  <span className="sm:ml-0">Text</span>
                  <span className="ml-auto hidden md:inline">Shift-click checkboxes to select a range</span>
                </div>
                <CueList
                  cues={cues}
                  pageIndices={pageIndices}
                  activeIndex={activeIndex}
                  selected={selectedSet}
                  issueMap={issueMap}
                  handlers={handlers}
                  page={currentPage}
                  pages={pages}
                  totalVisible={visible.length}
                  onPage={(p) => {
                    setPage(p);
                    listRef.current?.scrollIntoView({ block: "start" });
                  }}
                />
              </>
            )}
          </div>
        </section>
      </div>

      {/* Save bar */}
      <div className="sticky bottom-0 z-20 -mx-4 mt-6 border-t border-border bg-surface-1/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-card sm:border sm:shadow-pop">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 text-sm" aria-live="polite">
            {saveError ? (
              <p className="flex gap-1.5 text-danger">
                <Icon.AlertCircle className="mt-0.5 size-4 shrink-0" />
                <span>{saveError}</span>
              </p>
            ) : job ? (
              <p className="text-ink-muted">Saving is paused while a transcript is being generated.</p>
            ) : dirty ? (
              <p className="text-ink">
                <span className="font-medium">Unsaved changes.</span>{" "}
                <span className="text-ink-muted">{summary.empty > 0 ? `${summary.empty} empty ${summary.empty === 1 ? "caption is" : "captions are"} left out when saving.` : "Learners see them after you save."}</span>
              </p>
            ) : (
              <p className="text-ink-muted">{base ? "All changes saved." : "Nothing saved yet."}</p>
            )}
          </div>
          <div className="flex shrink-0 gap-2">
            <Button variant="ghost" onClick={() => setDialog("discard")} disabled={!dirty || saving}>
              Discard
            </Button>
            <Button onClick={() => save()} loading={saving} disabled={!dirty || !!job || !languageValid} leftIcon={<Icon.Check className="size-4" />} title="Save (Ctrl+S)">
              Save transcript
            </Button>
          </div>
        </div>
      </div>

      <ImportDialog open={dialog === "import"} onClose={() => setDialog(null)} currentCount={cues.length} videoCaptionsUrl={video.captionsUrl} onImport={applyImport} />
      {dialog === "shift" && (
        <ShiftDialog
          open
          onClose={() => setDialog(null)}
          count={cues.length}
          selection={selection}
          focusIndex={Math.max(0, activeIndex)}
          playhead={timeRef.current}
          cueStart={(i) => cues[i]?.start ?? null}
          onApply={applyTiming}
        />
      )}
      <ConfirmDialog
        open={dialog === "delete"}
        onClose={() => setDialog(null)}
        onConfirm={removeTranscript}
        loading={deleting}
        destructive
        title="Delete this transcript?"
        description={job ? "Generation in progress is stopped too. Learners lose the transcript panel and captions made from it. This can't be undone." : "Learners lose the transcript panel and the captions made from it. This can't be undone."}
        confirmLabel="Delete transcript"
      />
      <ConfirmDialog
        open={dialog === "discard"}
        onClose={() => setDialog(null)}
        onConfirm={discard}
        destructive
        title="Discard unsaved changes?"
        description={base ? "The editor goes back to the saved transcript." : "The editor is emptied."}
        confirmLabel="Discard changes"
      />
    </div>
  );
}
