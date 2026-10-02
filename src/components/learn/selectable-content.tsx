"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useTransition, type ReactNode } from "react";
import type { NoteColor } from "@/lib/types";
import { createHighlightAction, deleteNoteAction } from "@/lib/actions/notes";
import { cn } from "@/lib/utils";
import { Icon, Spinner } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import { useLocale, useT } from "@/i18n/client";
import { intlLocale } from "@/i18n/config";
import { useLessonRuntime } from "./lesson-runtime";
import { FLASH_HIGHLIGHT, HIGHLIGHT_CSS, NOTE_COLORS, highlightName } from "./note-colors";

/* ------------------------------------------------------------------ */
/* Text search across the rendered lesson content                       */
/* ------------------------------------------------------------------ */

interface TextIndex {
  nodes: Text[];
  starts: number[];
  text: string;
}

function buildTextIndex(root: HTMLElement): TextIndex {
  const nodes: Text[] = [];
  const starts: number[] = [];
  let text = "";
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      if (parent.closest("[data-no-highlight], script, style, button, textarea, input")) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n as Text;
    nodes.push(t);
    starts.push(text.length);
    text += t.data;
  }
  return { nodes, starts, text };
}

/** Collapse whitespace while remembering where each character came from. */
function normalizeWithMap(input: string): { norm: string; map: number[] } {
  let norm = "";
  const map: number[] = [];
  let lastWasSpace = true;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    if (/\s/.test(ch)) {
      if (lastWasSpace) continue;
      norm += " ";
      map.push(i);
      lastWasSpace = true;
    } else {
      norm += ch;
      map.push(i);
      lastWasSpace = false;
    }
  }
  return { norm, map };
}

function locate(index: TextIndex, offset: number): { node: Text; offset: number } | null {
  for (let i = index.nodes.length - 1; i >= 0; i--) {
    if (index.starts[i]! <= offset) return { node: index.nodes[i]!, offset: offset - index.starts[i]! };
  }
  return null;
}

/** Find the first occurrence of `needle` in the content and return it as a DOM Range. */
function findTextRange(index: TextIndex, needle: string): Range | null {
  const wanted = needle.replace(/\s+/g, " ").trim();
  if (!wanted || !index.text) return null;
  let start = index.text.indexOf(wanted);
  let end = start + wanted.length;
  if (start === -1) {
    const { norm, map } = normalizeWithMap(index.text);
    const at = norm.indexOf(wanted);
    if (at === -1) return null;
    start = map[at]!;
    end = map[at + wanted.length - 1]! + 1;
  }
  const a = locate(index, start);
  const b = locate(index, end - 1);
  if (!a || !b) return null;
  const range = document.createRange();
  range.setStart(a.node, a.offset);
  range.setEnd(b.node, b.offset + 1);
  return range;
}

function highlightsSupported(): boolean {
  return typeof CSS !== "undefined" && "highlights" in CSS && typeof Highlight !== "undefined";
}

/* ------------------------------------------------------------------ */
/* Component                                                            */
/* ------------------------------------------------------------------ */

interface MenuState {
  text: string;
  top: number;
  left: number;
  placement: "above" | "below";
}

const MAX_SELECTION = 2000;

/**
 * Wraps the lesson content. Paints saved highlights with the CSS Custom
 * Highlight API (the rendered content is never mutated) and shows a small
 * floating menu to highlight the selected text or turn it into a note.
 */
export function SelectableContent({ children, className }: { children: ReactNode; className?: string }) {
  const rt = useLessonRuntime();
  const toast = useToast();
  const t = useT("learning");
  const locale = useLocale();
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [pending, startTransition] = useTransition();
  const [pendingColor, setPendingColor] = useState<NoteColor | null>(null);
  const flashTimer = useRef<number | null>(null);
  /** Pointer is pressed on the menu: keep it open even if the selection collapses (touch devices). */
  const pointerInMenu = useRef(false);
  const interactive = rt.notesEnabled && rt.tracking;
  const { notes, registerQuoteFocus } = rt;

  // Paint saved highlights.
  useEffect(() => {
    const root = rootRef.current;
    if (!root || !highlightsSupported()) return;
    const paint = () => {
      const index = buildTextIndex(root);
      const byColor = new Map<NoteColor, Range[]>();
      for (const note of notes) {
        if (!note.highlightedText) continue;
        const range = findTextRange(index, note.highlightedText);
        if (!range) continue;
        const list = byColor.get(note.color) ?? [];
        list.push(range);
        byColor.set(note.color, list);
      }
      for (const c of NOTE_COLORS) {
        const ranges = byColor.get(c.value);
        if (ranges?.length) CSS.highlights.set(highlightName(c.value), new Highlight(...ranges));
        else CSS.highlights.delete(highlightName(c.value));
      }
    };
    paint();
    // Content can change after hydration (e.g. quiz blocks loading); repaint once shortly after.
    const timer = window.setTimeout(paint, 600);
    return () => {
      window.clearTimeout(timer);
      for (const c of NOTE_COLORS) CSS.highlights.delete(highlightName(c.value));
    };
  }, [notes]);

  // Let the notes panel scroll to (and flash) a quoted passage.
  useEffect(() => {
    return registerQuoteFocus((text) => {
      const root = rootRef.current;
      if (!root) return false;
      const range = findTextRange(buildTextIndex(root), text);
      if (!range) return false;
      const el = range.startContainer.parentElement;
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
      if (highlightsSupported()) {
        CSS.highlights.set(FLASH_HIGHLIGHT, new Highlight(range));
        if (flashTimer.current) window.clearTimeout(flashTimer.current);
        flashTimer.current = window.setTimeout(() => CSS.highlights.delete(FLASH_HIGHLIGHT), 3000);
      } else {
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
      return true;
    });
  }, [registerQuoteFocus]);

  useEffect(
    () => () => {
      if (flashTimer.current) window.clearTimeout(flashTimer.current);
      if (highlightsSupported()) CSS.highlights.delete(FLASH_HIGHLIGHT);
    },
    [],
  );

  const readSelection = useCallback(() => {
    const root = rootRef.current;
    const sel = window.getSelection();
    if (!root || !sel || sel.isCollapsed || sel.rangeCount === 0) {
      setMenu(null);
      return;
    }
    const range = sel.getRangeAt(0);
    if (!root.contains(range.commonAncestorContainer)) {
      setMenu(null);
      return;
    }
    const startEl = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement;
    const endEl = range.endContainer instanceof Element ? range.endContainer : range.endContainer.parentElement;
    if (startEl?.closest("[data-no-highlight]") || endEl?.closest("[data-no-highlight]")) {
      setMenu(null);
      return;
    }
    const text = range.toString().replace(/\s+/g, " ").trim();
    if (text.length < 2 || text.length > MAX_SELECTION) {
      setMenu(null);
      return;
    }
    const rect = range.getBoundingClientRect();
    // Centre on the selection; the layout effect below keeps the rendered toolbar inside the viewport.
    const left = rect.left + rect.width / 2;
    const placement = rect.top > 64 ? "above" : "below";
    setMenu({ text, left, top: placement === "above" ? rect.top - 8 : rect.bottom + 8, placement });
  }, []);

  // Close the menu when the selection collapses or the page scrolls.
  useEffect(() => {
    if (!menu) return;
    const onSelection = () => {
      if (pointerInMenu.current) return;
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) setMenu(null);
    };
    const onPointerUp = () => {
      window.setTimeout(() => {
        pointerInMenu.current = false;
      }, 400);
    };
    const onScroll = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(null);
    };
    document.addEventListener("selectionchange", onSelection);
    window.addEventListener("scroll", onScroll, { passive: true, capture: true });
    window.addEventListener("resize", onScroll);
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.removeEventListener("pointerup", onPointerUp);
      document.removeEventListener("selectionchange", onSelection);
      window.removeEventListener("scroll", onScroll, { capture: true });
      window.removeEventListener("resize", onScroll);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  const clearSelection = () => {
    window.getSelection()?.removeAllRanges();
    setMenu(null);
  };

  const existing = menu ? notes.find((n) => n.highlightedText && n.highlightedText === menu.text) : undefined;
  const hasRemove = !!existing;

  // Clamp the centred toolbar using its real rendered width (it grows when "Remove highlight" shows).
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!menu || !el) return;
    const margin = 8;
    const width = el.offsetWidth;
    const half = width / 2;
    const max = window.innerWidth - half - margin;
    const left = max < half + margin ? window.innerWidth / 2 : Math.min(Math.max(menu.left, half + margin), max);
    el.style.left = `${left}px`;
  }, [menu, hasRemove]);

  const highlight = (color: NoteColor) => {
    if (!menu) return;
    const text = menu.text;
    setPendingColor(color);
    startTransition(async () => {
      const res = await createHighlightAction({ lessonId: rt.lessonId, highlightedText: text, color });
      setPendingColor(null);
      if (!res.ok) {
        toast.error(t("learn.notes.highlightFailed"), res.error);
        return;
      }
      toast.success(t("learn.notes.highlightSaved"), t("learn.notes.highlightSavedHint"));
      clearSelection();
    });
  };

  const removeHighlight = () => {
    if (!existing) return;
    startTransition(async () => {
      const res = await deleteNoteAction(existing.id);
      if (!res.ok) {
        toast.error(t("learn.notes.removeHighlightFailed"), res.error);
        return;
      }
      toast.success(t("learn.notes.highlightRemoved"));
      clearSelection();
    });
  };

  const addNote = () => {
    if (!menu) return;
    rt.startNoteFromQuote(menu.text);
    clearSelection();
  };

  return (
    <div
      ref={rootRef}
      className={cn("relative", className)}
      onMouseUp={interactive ? () => window.setTimeout(readSelection, 0) : undefined}
      onKeyUp={interactive ? (e) => (e.shiftKey || e.key === "Shift" ? readSelection() : undefined) : undefined}
      onTouchEnd={interactive ? () => window.setTimeout(readSelection, 250) : undefined}
    >
      <style>{HIGHLIGHT_CSS}</style>
      {children}
      {menu && interactive && (
        <div
          ref={menuRef}
          role="toolbar"
          data-selection-toolbar=""
          aria-label={t("learn.notes.selectionActions")}
          className={cn(
            "fixed z-50 flex max-w-[calc(100vw-16px)] -translate-x-1/2 flex-wrap items-center justify-center gap-1 rounded-xl border border-border bg-surface-1 p-1 shadow-pop animate-scale-in",
            menu.placement === "above" ? "-translate-y-full" : "",
          )}
          style={{ top: menu.top, left: menu.left }}
          onMouseDown={(e) => e.preventDefault()}
          onPointerDown={() => {
            pointerInMenu.current = true;
          }}
        >
          <span className="sr-only">{t("learn.notes.highlight")}</span>
          {NOTE_COLORS.map((c) => {
            const label = t("learn.notes.highlightIn", { color: t(`learn.color.${c.value}`).toLocaleLowerCase(intlLocale(locale)) });
            return (
            <button
              key={c.value}
              type="button"
              disabled={pending}
              onClick={() => highlight(c.value)}
              className="flex size-8 items-center justify-center rounded-lg transition-colors hover:bg-surface-2 disabled:opacity-60"
              aria-label={label}
              title={label}
            >
              {pending && pendingColor === c.value ? <Spinner className="size-3.5" /> : <span className={cn("size-3.5 rounded-full ring-2 ring-surface-1", c.swatch)} />}
            </button>
            );
          })}
          <span className="mx-0.5 h-6 w-px bg-border" aria-hidden="true" />
          <button
            type="button"
            onClick={addNote}
            disabled={pending}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-ink transition-colors hover:bg-surface-2 disabled:opacity-60"
          >
            <Icon.Note className="size-4" /> {t("learn.notes.addNote")}
          </button>
          {existing && (
            <button
              type="button"
              onClick={removeHighlight}
              disabled={pending}
              className="inline-flex size-8 items-center justify-center rounded-lg text-danger transition-colors hover:bg-danger/10 disabled:opacity-60"
              aria-label={t("learn.notes.removeHighlight")}
              title={t("learn.notes.removeHighlight")}
            >
              <Icon.Trash className="size-4" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
