"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { loadConversationAction } from "@/lib/actions/ai";
import { createSseParser } from "@/lib/ai/sse";
import type { AiErrorCode, ChatMessageView, ChatStreamEvent, CitationView, ConversationSummary, QuotaView } from "@/lib/ai/types";

export interface ChatError {
  code: AiErrorCode | "network";
  message: string;
  /** Epoch ms after which "Try again" is enabled. */
  retryAt?: number;
  /** The question that failed, for "Try again". */
  question: string;
}

export interface StreamingAnswer {
  text: string;
  citations: CitationView[];
}

export interface UseAiChatOptions {
  courseId: string;
  /** The lesson a new conversation is about; an existing conversation keeps the lesson it was started from. */
  lessonId?: string | null;
  initialConversation?: ConversationSummary | null;
  initialMessages?: ChatMessageView[];
  initialQuota?: QuotaView | null;
  /** Called when a conversation was created or its summary changed (an answer was stored). */
  onConversation?: (conversation: ConversationSummary) => void;
}

interface ErrorBody {
  code?: AiErrorCode;
  error?: string;
  retryAfter?: number;
  quota?: QuotaView;
}

/** How long after "Stop" the stored partial answer is fetched (the server saves it when the request is cancelled). */
const STOP_SYNC_DELAY_MS = 1200;

/**
 * Client state for one AI tutor conversation: sends questions to
 * `/api/ai/chat`, reads the SSE stream and batches text updates per animation
 * frame so long answers render smoothly.
 *
 * A question that gets no answer is taken out of the list again (the server
 * doesn't keep it either) and offered back through "Try again".
 */
export function useAiChat({ courseId, lessonId, initialConversation = null, initialMessages = [], initialQuota = null, onConversation }: UseAiChatOptions) {
  const [conversation, setConversation] = useState<ConversationSummary | null>(initialConversation);
  const [messages, setMessages] = useState<ChatMessageView[]>(initialMessages);
  const [streaming, setStreaming] = useState<StreamingAnswer | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ChatError | null>(null);
  const [quota, setQuota] = useState<QuotaView | null>(initialQuota);
  const [announcement, setAnnouncement] = useState("");

  const abortRef = useRef<AbortController | null>(null);
  /** Bumped whenever the conversation on screen is replaced, so a request that is still running can't write into it. */
  const runRef = useRef(0);
  const textRef = useRef("");
  const citationsRef = useRef<CitationView[]>([]);
  const frameRef = useRef<number | null>(null);
  const conversationRef = useRef<ConversationSummary | null>(initialConversation);
  const onConversationRef = useRef(onConversation);

  useEffect(() => {
    onConversationRef.current = onConversation;
  }, [onConversation]);

  const cancelFrame = useCallback(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
  }, []);

  useEffect(
    () => () => {
      runRef.current++;
      abortRef.current?.abort();
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    },
    [],
  );

  const scheduleFlush = useCallback(() => {
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      setStreaming({ text: textRef.current, citations: citationsRef.current });
    });
  }, []);

  const setCurrentConversation = useCallback((next: ConversationSummary | null) => {
    conversationRef.current = next;
    setConversation(next);
  }, []);

  /** Replace the conversation shown (picked from the history list, or null for a new one). */
  const load = useCallback(
    (next: { conversation: ConversationSummary | null; messages: ChatMessageView[] }) => {
      runRef.current++;
      abortRef.current?.abort();
      abortRef.current = null;
      cancelFrame();
      setCurrentConversation(next.conversation);
      setMessages(next.messages);
      setStreaming(null);
      setPending(false);
      setError(null);
      setAnnouncement("");
    },
    [cancelFrame, setCurrentConversation],
  );

  const updateMessage = useCallback((id: string, patch: Partial<ChatMessageView>) => {
    setMessages((list) => list.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  }, []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const send = useCallback(
    async (question: string) => {
      const text = question.trim();
      if (!text || abortRef.current) return;
      const run = ++runRef.current;
      const live = () => runRef.current === run;
      const controller = new AbortController();
      abortRef.current = controller;
      const previous = conversationRef.current;
      setError(null);
      setPending(true);
      setAnnouncement("");
      textRef.current = "";
      citationsRef.current = [];
      let questionId = `local-${Date.now()}`;
      setMessages((list) => [...list, { id: questionId, role: "user", content: text, createdAt: new Date().toISOString(), citations: [] }]);
      setStreaming({ text: "", citations: [] });

      /** The question got no answer: the server removed it (and a conversation it had just created). */
      const dropQuestion = () => {
        const id = questionId;
        setMessages((list) => list.filter((m) => m.id !== id));
        setCurrentConversation(previous);
      };
      const fail = (code: ChatError["code"], message: string, retryAfter?: number) => {
        dropQuestion();
        setError({ code, message, question: text, retryAt: retryAfter ? Date.now() + retryAfter * 1000 : undefined });
        setAnnouncement(message);
      };
      const publish = (summary: ConversationSummary) => {
        setCurrentConversation(summary);
        onConversationRef.current?.(summary);
      };

      let finished = false;
      const handle = (event: ChatStreamEvent) => {
        if (!live()) return;
        switch (event.type) {
          case "start": {
            const localId = questionId;
            questionId = event.userMessage.id;
            setCurrentConversation(event.conversation);
            setQuota(event.quota);
            setMessages((list) => list.map((m) => (m.id === localId ? event.userMessage : m)));
            break;
          }
          case "citations":
            citationsRef.current = event.citations;
            setStreaming({ text: textRef.current, citations: event.citations });
            break;
          case "delta":
            textRef.current += event.text;
            scheduleFlush();
            break;
          case "done": {
            finished = true;
            setMessages((list) => [...list, event.message]);
            setQuota(event.quota);
            const summary = conversationRef.current;
            if (summary) publish({ ...summary, updatedAt: event.message.createdAt, messageCount: summary.messageCount + 1 });
            setAnnouncement("The tutor finished answering.");
            break;
          }
          case "error":
            finished = true;
            fail(event.code, event.message, event.retryAfter);
            break;
        }
      };

      try {
        const res = await fetch("/api/ai/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ courseId, conversationId: previous?.id ?? null, lessonId: previous ? null : (lessonId ?? null), message: text }),
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          const body = (await res.json().catch(() => null)) as ErrorBody | null;
          if (!live()) return;
          if (body?.quota) setQuota(body.quota);
          const retryAfter = body?.retryAfter ?? (Number(res.headers.get("retry-after")) || undefined);
          fail(body?.code ?? "provider_error", body?.error ?? "The AI tutor couldn't answer this time. Please try again.", retryAfter);
          return;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        const parser = createSseParser(({ data }) => {
          let event: ChatStreamEvent;
          try {
            event = JSON.parse(data) as ChatStreamEvent;
          } catch {
            return; // Ignore a malformed event; a missing "done" is reported below.
          }
          handle(event);
        });
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          parser.push(decoder.decode(value, { stream: true }));
        }
        parser.push(decoder.decode());
        parser.end();
        if (live() && !finished) fail("network", "The connection was interrupted before the answer finished. Please try again.");
      } catch {
        if (!live()) return;
        if (!controller.signal.aborted) {
          const offline = typeof navigator !== "undefined" && navigator.onLine === false;
          fail("network", offline ? "You seem to be offline. Check your connection and try again." : "The AI tutor couldn't be reached. Please try again.");
          return;
        }
        // Stopped by the learner. The server keeps what was written so far; without any text it drops the question.
        const partial = textRef.current.trim();
        if (!partial) {
          dropQuestion();
          return;
        }
        setMessages((list) => [...list, { id: `stopped-${Date.now()}`, role: "assistant", content: partial, createdAt: new Date().toISOString(), citations: citationsRef.current }]);
        setAnnouncement("Stopped.");
        const started = conversationRef.current;
        if (!started) return;
        publish({ ...started, updatedAt: new Date().toISOString(), messageCount: started.messageCount + 1 });
        // Swap in the stored messages so the partial answer can be rated and reported.
        window.setTimeout(() => {
          if (!live()) return;
          void loadConversationAction(started.id)
            .then((result) => {
              if (!live() || !result.ok || result.data.messages.at(-1)?.role !== "assistant") return;
              setMessages(result.data.messages);
              publish(result.data.conversation);
            })
            .catch(() => undefined);
        }, STOP_SYNC_DELAY_MS);
      } finally {
        if (live()) {
          cancelFrame();
          abortRef.current = null;
          setStreaming(null);
          setPending(false);
        }
      }
    },
    [courseId, lessonId, scheduleFlush, cancelFrame, setCurrentConversation],
  );

  const retry = useCallback(() => {
    if (!error) return;
    const question = error.question;
    setError(null);
    void send(question);
  }, [error, send]);

  const dismissError = useCallback(() => setError(null), []);

  return { conversation, messages, streaming, pending, error, quota, announcement, send, stop, retry, load, updateMessage, dismissError };
}
