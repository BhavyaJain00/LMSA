"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type MouseEvent } from "react";
import type { ChatMessageView, CitationView } from "@/lib/ai/types";
import { linkCitations } from "@/lib/ai/citations";
import { citedNumbers } from "@/lib/ai/prompt";
import { REPORT_REASONS } from "@/lib/ai/reports";
import { Markdown } from "@/lib/markdown";
import { rateAnswerAction, reportAnswerAction } from "@/lib/actions/ai";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icons";
import { RadioCard } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { FlagIcon, ThumbDownIcon, ThumbUpIcon } from "./ai-icons";

const REPORT_OPTIONS = Object.entries(REPORT_REASONS).map(([value, label]) => ({ value, label }));

/** Messages created in the browser (a stopped answer) can't take feedback until reloaded. */
function isStored(id: string): boolean {
  return !id.startsWith("local-") && !id.startsWith("stopped-");
}

/** Citations the answer actually refers to. */
function citedOnly(content: string, citations: CitationView[]): CitationView[] {
  const used = new Set(citedNumbers(content, citations.length));
  return citations.filter((c) => used.has(c.n));
}

export function CitationChips({ citations, compact }: { citations: CitationView[]; compact?: boolean }) {
  if (!citations.length) return null;
  return (
    <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Sources">
      {citations.map((c) => (
        <li key={c.n} className="min-w-0 max-w-full">
          <Link
            href={c.href}
            title={c.snippet}
            className="group inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-surface-1 px-2.5 py-1 text-xs text-ink-muted transition-colors hover:border-accent/50 hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
          >
            <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-accent/12 text-[10px] font-semibold text-accent">{c.n}</span>
            <span className={cn("truncate", compact ? "max-w-40" : "max-w-64")}>{c.title}</span>
            {c.detail && <span className="shrink-0 tabular-nums text-ink-faint">· {c.detail.replace(/^video at /, "")}</span>}
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** The instructor's correction (or approval) attached to an answer. */
export function InstructorNote({ message }: { message: Pick<ChatMessageView, "reviewStatus" | "instructorNote"> }) {
  if (message.reviewStatus === "corrected" && message.instructorNote) {
    return (
      <div className="mt-3 rounded-xl border border-info/30 bg-info/8 px-3.5 py-3">
        <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-info">
          <Icon.GraduationCap className="size-3.5" /> Instructor correction
        </p>
        <Markdown content={message.instructorNote} className="text-sm" />
      </div>
    );
  }
  if (message.reviewStatus === "approved") {
    return (
      <p className="mt-2 inline-flex items-center gap-1 text-xs text-success">
        <Icon.CheckCircle className="size-3.5" /> Reviewed by an instructor
      </p>
    );
  }
  return null;
}

interface AnswerActionsProps {
  message: ChatMessageView;
  onChange: (patch: Partial<ChatMessageView>) => void;
}

function AnswerActions({ message, onChange }: AnswerActionsProps) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [reportOpen, setReportOpen] = useState(false);
  const [reason, setReason] = useState("incorrect");
  const [copied, setCopied] = useState(false);

  const rate = (value: boolean) => {
    const next = message.helpful === value ? null : value;
    startTransition(async () => {
      const result = await rateAnswerAction(message.id, next);
      if (!result.ok) return toast.error(result.error);
      onChange({ helpful: result.data.helpful ?? undefined, flagged: result.data.flagged });
      if (next === false) toast.success(result.message ?? "Thanks for the feedback");
    });
  };

  const report = () => {
    startTransition(async () => {
      const result = await reportAnswerAction(message.id, reason);
      if (!result.ok) return toast.error(result.error);
      onChange({ flagged: true, reviewStatus: message.reviewStatus === "corrected" || message.reviewStatus === "approved" ? message.reviewStatus : "pending" });
      setReportOpen(false);
      toast.success(result.message ?? "Reported");
    });
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't copy to the clipboard.");
    }
  };

  const buttonClass =
    "inline-flex size-7 items-center justify-center rounded-md text-ink-faint transition-colors hover:bg-surface-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50";

  return (
    <div className="mt-2 flex items-center gap-0.5" role="group" aria-label="Rate this answer">
      <button type="button" className={cn(buttonClass, message.helpful === true && "text-success")} aria-pressed={message.helpful === true} aria-label="Helpful" title="Helpful" onClick={() => rate(true)} disabled={pending}>
        <ThumbUpIcon className="size-4" />
      </button>
      <button type="button" className={cn(buttonClass, message.helpful === false && "text-danger")} aria-pressed={message.helpful === false} aria-label="Not helpful" title="Not helpful" onClick={() => rate(false)} disabled={pending}>
        <ThumbDownIcon className="size-4" />
      </button>
      <button type="button" className={buttonClass} aria-label={copied ? "Copied" : "Copy answer"} title={copied ? "Copied" : "Copy answer"} onClick={() => void copy()}>
        {copied ? <Icon.Check className="size-4 text-success" /> : <Icon.Copy className="size-4" />}
      </button>
      <button type="button" className={cn(buttonClass, message.flagged && "text-warning")} aria-label="Report answer" title="Report answer" onClick={() => setReportOpen(true)} disabled={pending}>
        <FlagIcon className="size-4" />
      </button>
      {message.flagged && message.reviewStatus === "pending" && <span className="ml-1.5 text-xs text-ink-faint">Sent for instructor review</span>}

      <Dialog
        open={reportOpen}
        onClose={() => setReportOpen(false)}
        title="Report this answer"
        description="An instructor of the course will review it. Your conversation is shared with the course team for this review."
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setReportOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={report} loading={pending} leftIcon={<FlagIcon className="size-4" />}>
              Report
            </Button>
          </>
        }
      >
        <fieldset className="space-y-2">
          <legend className="mb-2 text-sm font-medium text-ink">What&apos;s wrong with it?</legend>
          {REPORT_OPTIONS.map((o) => (
            <RadioCard key={o.value} name="report-reason" value={o.value} checked={reason === o.value} onChange={setReason} title={o.label} />
          ))}
        </fieldset>
      </Dialog>
    </div>
  );
}

export interface ChatMessageProps {
  message: ChatMessageView;
  compact?: boolean;
  onChange?: (patch: Partial<ChatMessageView>) => void;
}

export function ChatMessage({ message, compact, onChange }: ChatMessageProps) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[88%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-accent px-3.5 py-2.5 text-sm text-accent-fg">{message.content}</div>
      </div>
    );
  }
  const cited = citedOnly(message.content, message.citations);
  return (
    <div className="flex gap-2.5">
      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-accent/12 text-accent" aria-hidden="true">
        <Icon.Sparkles className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <AnswerBody content={message.content} citations={message.citations} />
        {message.unknown && (
          <p className="mt-2 rounded-lg bg-surface-2 px-3 py-2 text-xs text-ink-muted">
            The course material doesn&apos;t seem to cover this yet. Your question helps the instructors find gaps; you can also ask in the lesson discussion.
          </p>
        )}
        <CitationChips citations={cited} compact={compact} />
        <InstructorNote message={message} />
        {onChange && isStored(message.id) && <AnswerActions message={message} onChange={onChange} />}
      </div>
    </div>
  );
}

/** Markdown answer with [n] markers linked to their lessons. */
export function AnswerBody({ content, citations, streaming }: { content: string; citations: CitationView[]; streaming?: boolean }) {
  const router = useRouter();
  const linked = linkCitations(
    content,
    citations.map((c) => ({ n: c.n, href: c.href, title: c.detail ? `${c.title} · ${c.detail}` : c.title })),
  );
  /** Source links inside the answer open without a full page load, so the chat keeps its place. */
  const openInApp = (e: MouseEvent<HTMLDivElement>) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || !(e.target instanceof Element)) return;
    const href = e.target.closest("a")?.getAttribute("href");
    if (!href || !href.startsWith("/") || href.startsWith("//")) return;
    e.preventDefault();
    router.push(href);
  };
  return (
    <div onClick={openInApp} className="text-sm text-ink [&_.prose-ll]:text-sm [&_pre]:max-w-full [&_pre]:overflow-x-auto">
      <Markdown content={linked} />
      {streaming && <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse rounded-sm bg-accent align-text-bottom" aria-hidden="true" />}
    </div>
  );
}
