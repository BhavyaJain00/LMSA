"use client";

import Link from "next/link";
import { useState, useTransition, type MouseEvent } from "react";
import type { ChatMessageView, ConversationSummary, QuotaView } from "@/lib/ai/types";
import { deleteConversationAction } from "@/lib/actions/ai";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import { useOptionalLessonRuntime } from "@/components/learn/lesson-runtime";
import { AiChatView } from "./ai-chat";
import { useAiChat } from "./use-ai-chat";

export interface AiTutorPanelProps {
  courseId: string;
  courseSlug: string;
  courseTitle: string;
  lessonId: string;
  starterQuestions: string[];
  initialConversation: ConversationSummary | null;
  initialMessages: ChatMessageView[];
  initialQuota: QuotaView | null;
}

const toolClass =
  "inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-ink-muted hover:bg-surface-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50";

/**
 * "Ask AI" tab of the lesson sidebar: a compact chat about the current
 * lesson. It reopens the learner's latest conversation about the lesson;
 * older ones are on the full page.
 */
export function AiTutorPanel({ courseId, courseSlug, courseTitle, lessonId, starterQuestions, initialConversation, initialMessages, initialQuota }: AiTutorPanelProps) {
  const toast = useToast();
  const runtime = useOptionalLessonRuntime();
  const chat = useAiChat({ courseId, lessonId, initialConversation, initialMessages, initialQuota });
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, startClear] = useTransition();
  const conversation = chat.conversation;
  const fullPage = `/courses/${courseSlug}/ask${conversation ? `?c=${conversation.id}` : `?lesson=${lessonId}`}`;

  const clear = () => {
    if (!conversation) return;
    startClear(async () => {
      const result = await deleteConversationAction(conversation.id).catch(() => null);
      setConfirmClear(false);
      if (!result?.ok) {
        toast.error(result?.error ?? "The conversation couldn't be deleted. Try again.");
        return;
      }
      chat.load({ conversation: null, messages: [] });
      toast.success("Conversation cleared");
    });
  };

  /** Following a source link on a phone closes the sheet, so the lesson (or the video at that moment) is visible. */
  const closeSheetOnLink = (e: MouseEvent<HTMLDivElement>) => {
    if (e.target instanceof Element && e.target.closest("a[href]")) runtime?.setMobileSidebarOpen(false);
  };

  return (
    <div className="flex h-full min-h-96 flex-col" onClick={closeSheetOnLink}>
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2">
        <p className="min-w-0 truncate text-xs font-medium text-ink-muted">{conversation ? conversation.title : "New conversation"}</p>
        <div className="flex shrink-0 items-center gap-0.5">
          {conversation && (
            <>
              <button type="button" onClick={() => chat.load({ conversation: null, messages: [] })} disabled={chat.pending} className={toolClass}>
                <Icon.Plus className="size-3.5" /> New
              </button>
              <button type="button" onClick={() => setConfirmClear(true)} disabled={chat.pending} className={toolClass} aria-label="Clear this conversation" title="Clear this conversation">
                <Icon.Trash className="size-3.5" />
              </button>
            </>
          )}
          <Link href={fullPage} className={toolClass} title="Open the AI tutor on its own page, with your earlier conversations">
            <Icon.ExternalLink className="size-3.5" /> Full page
          </Link>
        </div>
      </div>
      <AiChatView chat={chat} starterQuestions={starterQuestions} courseTitle={courseTitle} compact className="min-h-0 flex-1" />

      <ConfirmDialog
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        onConfirm={clear}
        title="Clear this conversation?"
        description="The questions and answers in this conversation will be deleted for good."
        confirmLabel="Clear"
        destructive
        loading={clearing}
      />
    </div>
  );
}
