"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { MAX_QUESTION_CHARS } from "@/lib/ai/prompt";
import { Icon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";
import { ArrowUpIcon, StopIcon } from "./ai-icons";
import { AnswerBody, ChatMessage } from "./chat-message";
import type { useAiChat } from "./use-ai-chat";

type Chat = ReturnType<typeof useAiChat>;

export interface AiChatViewProps {
  chat: Chat;
  /** Suggested first questions (from the current lesson's headings). */
  starterQuestions: string[];
  courseTitle: string;
  /** Narrow layout for the lesson sidebar. */
  compact?: boolean;
  className?: string;
  /** Extra controls rendered above the composer (e.g. "Open full page"). */
  footerExtra?: ReactNode;
}

function useCountdown(until: number | undefined): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!until) return;
    const tick = () => setNow(Date.now());
    const timer = window.setInterval(tick, 1000);
    const first = window.setTimeout(tick, 0);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(first);
    };
  }, [until]);
  return until ? Math.max(0, Math.ceil((until - now) / 1000)) : 0;
}

/** Conversation surface of the AI tutor: messages, streaming answer, errors and the composer. */
export function AiChatView({ chat, starterQuestions, courseTitle, compact, className, footerExtra }: AiChatViewProps) {
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const stickRef = useRef(true);
  const inputId = useId();
  const hintId = useId();
  const busy = chat.pending;
  const wait = useCountdown(chat.error?.retryAt);
  const quotaOut = chat.quota?.remaining === 0;

  // Keep the newest text in view while the learner hasn't scrolled up.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [chat.messages, chat.streaming, chat.error]);

  // Grow the textarea with its content (up to a limit).
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, compact ? 140 : 200)}px`;
  }, [draft, compact]);

  const submit = (text: string) => {
    const question = text.trim();
    if (!question || busy || quotaOut) return;
    stickRef.current = true;
    setDraft("");
    void chat.send(question);
  };

  const empty = chat.messages.length === 0 && !chat.streaming;
  const tooLong = draft.length > MAX_QUESTION_CHARS;

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className={cn("min-h-0 flex-1 overflow-y-auto overscroll-contain scrollbar-thin", compact ? "px-3 py-3" : "px-4 py-5 sm:px-6")}
      >
        {empty ? (
          <div className={cn("mx-auto flex max-w-md flex-col items-center text-center", compact ? "py-4" : "py-10")}>
            <span className="mb-3 flex size-11 items-center justify-center rounded-full bg-accent/12 text-accent">
              <Icon.Sparkles className="size-5" />
            </span>
            <h2 className="text-base font-semibold text-ink">Ask about {courseTitle}</h2>
            <p className="mt-1 text-sm text-ink-muted">Answers come only from this course&apos;s lessons, with links to the parts they&apos;re based on.</p>
            {starterQuestions.length > 0 && (
              <div className="mt-4 flex w-full flex-col gap-2">
                {starterQuestions.map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => submit(q)}
                    disabled={busy || quotaOut}
                    className="rounded-xl border border-border bg-surface-1 px-3.5 py-2.5 text-left text-sm text-ink transition-colors hover:border-accent/50 hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-60"
                  >
                    {q}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div role="log" aria-label="Conversation with the AI tutor" aria-busy={busy} className={cn("mx-auto flex w-full flex-col", compact ? "gap-4" : "max-w-3xl gap-5")}>
            {chat.messages.map((m) => (
              <ChatMessage key={m.id} message={m} compact={compact} onChange={(patch) => chat.updateMessage(m.id, patch)} />
            ))}
            {chat.streaming && (
              <div className="flex gap-2.5">
                <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-accent/12 text-accent" aria-hidden="true">
                  <Icon.Sparkles className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  {chat.streaming.text ? (
                    <AnswerBody content={chat.streaming.text} citations={chat.streaming.citations} streaming />
                  ) : (
                    <p className="flex items-center gap-2 py-1 text-sm text-ink-muted">
                      <span className="flex gap-1" aria-hidden="true">
                        <span className="size-1.5 animate-bounce rounded-full bg-ink-faint [animation-delay:-0.2s]" />
                        <span className="size-1.5 animate-bounce rounded-full bg-ink-faint [animation-delay:-0.1s]" />
                        <span className="size-1.5 animate-bounce rounded-full bg-ink-faint" />
                      </span>
                      Looking through the course…
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <p className="sr-only" role="status" aria-live="polite">
        {chat.announcement}
      </p>

      <div className={cn("shrink-0 border-t border-border bg-surface-1", compact ? "p-3" : "px-4 py-3 sm:px-6")}>
        <div className={cn(!compact && "mx-auto max-w-3xl")}>
          {chat.error && (
            <div role="alert" className="mb-2.5 flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/8 px-3 py-2 text-sm text-ink">
              <Icon.AlertCircle className="mt-0.5 size-4 shrink-0 text-danger" />
              <p className="min-w-0 flex-1">{chat.error.message}</p>
              {chat.error.code !== "quota" && chat.error.code !== "forbidden" && chat.error.code !== "not_configured" && (
                <button type="button" onClick={chat.retry} disabled={wait > 0 || busy} className="shrink-0 font-medium text-accent hover:underline disabled:text-ink-faint disabled:no-underline">
                  {wait > 0 ? `Retry in ${wait}s` : "Try again"}
                </button>
              )}
              <button type="button" onClick={chat.dismissError} className="shrink-0 rounded p-0.5 text-ink-faint hover:text-ink" aria-label="Dismiss">
                <Icon.X className="size-3.5" />
              </button>
            </div>
          )}
          {footerExtra}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!tooLong) submit(draft);
            }}
            className="flex items-end gap-2 rounded-xl border border-border-strong bg-surface-1 p-1.5 focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20"
          >
            <label htmlFor={inputId} className="sr-only">
              Your question
            </label>
            <textarea
              ref={inputRef}
              id={inputId}
              rows={1}
              value={draft}
              maxLength={MAX_QUESTION_CHARS + 200}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  if (!tooLong) submit(draft);
                }
              }}
              placeholder={quotaOut ? "Daily question limit reached" : "Ask a question about this course…"}
              disabled={quotaOut}
              aria-describedby={hintId}
              aria-invalid={tooLong || undefined}
              className="max-h-52 min-h-9 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm text-ink placeholder:text-ink-faint focus:outline-none disabled:cursor-not-allowed"
            />
            {busy ? (
              <button type="button" onClick={chat.stop} className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-ink text-surface-1 hover:opacity-90" aria-label="Stop answering" title="Stop">
                <StopIcon className="size-4" />
              </button>
            ) : (
              <button
                type="submit"
                disabled={!draft.trim() || tooLong || quotaOut}
                className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-fg transition hover:brightness-110 disabled:opacity-40"
                aria-label="Send question"
                title="Send (Enter)"
              >
                <ArrowUpIcon className="size-4" />
              </button>
            )}
          </form>
          <p id={hintId} className="mt-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 text-[11px] text-ink-faint">
            <span>AI answers can be wrong. They use only this course&apos;s material, so check the linked lessons.</span>
            <span className="tabular-nums">
              {tooLong ? (
                <span className="text-danger">
                  {draft.length.toLocaleString()}/{MAX_QUESTION_CHARS.toLocaleString()}
                </span>
              ) : chat.quota && chat.quota.limit > 0 ? (
                `${chat.quota.remaining ?? chat.quota.limit} of ${chat.quota.limit} questions left today`
              ) : null}
            </span>
          </p>
        </div>
      </div>
    </div>
  );
}
