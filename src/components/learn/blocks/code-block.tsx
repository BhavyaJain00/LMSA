"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icons";
import { useT } from "@/i18n/client";

const LANGUAGE_LABELS: Record<string, string> = {
  js: "JavaScript",
  javascript: "JavaScript",
  jsx: "JSX",
  ts: "TypeScript",
  typescript: "TypeScript",
  tsx: "TSX",
  py: "Python",
  python: "Python",
  sh: "Shell",
  bash: "Bash",
  shell: "Shell",
  zsh: "Shell",
  console: "Console",
  html: "HTML",
  xml: "XML",
  css: "CSS",
  scss: "SCSS",
  json: "JSON",
  yaml: "YAML",
  yml: "YAML",
  toml: "TOML",
  md: "Markdown",
  markdown: "Markdown",
  sql: "SQL",
  go: "Go",
  rust: "Rust",
  rs: "Rust",
  java: "Java",
  kotlin: "Kotlin",
  c: "C",
  cpp: "C++",
  "c++": "C++",
  cs: "C#",
  csharp: "C#",
  php: "PHP",
  ruby: "Ruby",
  rb: "Ruby",
  swift: "Swift",
  diff: "Diff",
  plaintext: "Plain text",
  text: "Plain text",
  txt: "Plain text",
};

/** Display name of a code language; `names` words the generic labels in the interface language. */
export function languageLabel(language: string, names: { code: string; plainText: string } = { code: "Code", plainText: "Plain text" }): string {
  const key = language.trim().toLowerCase();
  if (!key) return names.code;
  const label = LANGUAGE_LABELS[key];
  if (label === "Plain text") return names.plainText;
  return label ?? language.trim();
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the legacy path (e.g. insecure context).
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

/** Code sample with a language label and a copy button. */
export function CodeBlock({ language, code, className }: { language: string; code: string; className?: string }) {
  const t = useT("learning");
  const common = useT("common");
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<number | null>(null);
  const lines = code.split("\n").length;
  const label = languageLabel(language, { code: t("learn.code.code"), plainText: t("learn.code.plainText") });

  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );

  const onCopy = async () => {
    const ok = await copyText(code);
    setState(ok ? "copied" : "failed");
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState("idle"), 1800);
  };

  return (
    <figure className={cn("mx-auto w-full max-w-(--lesson-w) overflow-hidden rounded-xl border border-border bg-surface-1", className)}>
      <figcaption className="flex items-center justify-between gap-2 border-b border-border bg-surface-2 px-3 py-1.5">
        <span className="flex items-center gap-2 text-xs font-medium text-ink-muted">
          <Icon.Code className="size-3.5" />
          {label}
          <span className="text-ink-faint">· {t("learn.code.lines", { count: lines })}</span>
        </span>
        <button
          type="button"
          onClick={() => void onCopy()}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-colors",
            state === "copied" ? "text-success" : state === "failed" ? "text-danger" : "text-ink-muted hover:bg-surface-3 hover:text-ink",
          )}
          aria-label={state === "copied" ? t("learn.code.codeCopied") : t("learn.code.copyCode")}
        >
          {state === "copied" ? <Icon.Check className="size-3.5" /> : <Icon.Copy className="size-3.5" />}
          {state === "copied" ? common("actions.copied") : state === "failed" ? t("learn.code.copyFailed") : common("actions.copy")}
        </button>
        <span className="sr-only" aria-live="polite">
          {state === "copied" ? t("learn.code.copiedSr") : ""}
        </span>
      </figcaption>
      <div className="prose-ll">
        <pre className="m-0! rounded-none! scrollbar-thin" data-lang={language || undefined} tabIndex={0} aria-label={t("learn.code.ariaLabel", { language: label })} dir="ltr">
          <code>{code}</code>
        </pre>
      </div>
    </figure>
  );
}
