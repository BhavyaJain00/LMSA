"use client";

import { useState, useTransition } from "react";
import type { Settings } from "@/lib/types";
import { saveAiSettingsAction, testAiConnectionAction, type ConnectionResult } from "@/lib/actions/ai";
import { AI_MODEL_OPTIONS } from "@/lib/ai/models";
import { MAX_PROMPT_ADDITION_CHARS } from "@/lib/ai/prompt";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { Input, RadioCard, Switch, Textarea } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useFormatter, useT } from "@/i18n/client";
import { SettingsRow, SettingsSection, SettingsSwitchRow } from "./settings-ui";
import { SaveBar } from "./save-bar";
import { useFormAction } from "./use-form-action";

const CUSTOM = "__custom";

export interface AiSettingsFormProps {
  initial: Settings["ai"];
  /** Masked ANTHROPIC_API_KEY ("" when not set). */
  keyHint: string;
  /** The built-in ground rules, shown read-only for reference. */
  baseRules: string;
}

type TestState = { ok: true; result: ConnectionResult } | { ok: false; error: string } | null;

/** Admin → Settings → AI tutor: switch, model, daily limit, extra instructions, review queue and a connection test. */
export function AiSettingsForm({ initial, keyHint, baseRules }: AiSettingsFormProps) {
  const t = useT("admin");
  const f = useFormatter();
  const { onSubmit, pending, errors, dirty, markDirty, state } = useFormAction(saveAiSettingsAction);
  const known = AI_MODEL_OPTIONS.some((m) => m.id === initial.model);
  const [choice, setChoice] = useState(known ? initial.model : CUSTOM);
  const [customModel, setCustomModel] = useState(known ? "" : initial.model);
  const [enabled, setEnabled] = useState(initial.enabled);
  const [prompt, setPrompt] = useState(initial.systemPrompt ?? "");
  const [showRules, setShowRules] = useState(false);
  const [test, setTest] = useState<TestState>(null);
  const [testing, startTest] = useTransition();

  const model = choice === CUSTOM ? customModel.trim() : choice;
  const keyConfigured = keyHint.length > 0;

  const runTest = () => {
    setTest(null);
    startTest(async () => {
      const result = await testAiConnectionAction(model);
      setTest(result.ok ? { ok: true, result: result.data } : { ok: false, error: result.error });
    });
  };

  return (
    <form onSubmit={onSubmit} onChange={markDirty} noValidate className="space-y-6">
      <SettingsSection title={t("aiForm.availability.title")}>
        <SettingsSwitchRow error={errors.enabled}>
          <Switch
            name="enabled"
            checked={enabled}
            onChange={(e) => setEnabled(e.currentTarget.checked)}
            label={t("aiForm.enabled.label")}
            description={t("aiForm.enabled.description")}
          />
          {enabled && !keyConfigured && (
            <p className="mt-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-ink">
              {t("aiForm.enabled.keyMissing", { name: "ANTHROPIC_API_KEY" })}
            </p>
          )}
        </SettingsSwitchRow>
        <SettingsSwitchRow error={errors.reviewQueue}>
          <Switch
            name="reviewQueue"
            defaultChecked={initial.reviewQueue}
            label={t("aiForm.reviewQueue.label")}
            description={t("aiForm.reviewQueue.description")}
          />
        </SettingsSwitchRow>
      </SettingsSection>

      <SettingsSection title={t("aiForm.model.title")} description={t("aiForm.model.description")}>
        <div className="space-y-2 px-4 py-4 sm:px-5" role="radiogroup" aria-label={t("aiForm.model.groupLabel")}>
          <input type="hidden" name="model" value={model} />
          {AI_MODEL_OPTIONS.map((option) => (
            <RadioCard
              key={option.id}
              name="modelChoice"
              value={option.id}
              checked={choice === option.id}
              onChange={(value) => {
                setChoice(value);
                setTest(null);
              }}
              title={
                <span className="flex flex-wrap items-center gap-2">
                  {option.label}
                  <code className="rounded bg-surface-2 px-1.5 py-0.5 text-[11px] font-normal text-ink-muted">{option.id}</code>
                </span>
              }
              description={t("aiForm.model.pricing", { note: option.note, input: `$${option.inputPerMillion}`, output: `$${option.outputPerMillion}` })}
            />
          ))}
          <RadioCard
            name="modelChoice"
            value={CUSTOM}
            checked={choice === CUSTOM}
            onChange={(value) => {
              setChoice(value);
              setTest(null);
            }}
            title={t("aiForm.model.custom")}
            description={t("aiForm.model.customDescription")}
          />
          {choice === CUSTOM && (
            <div className="ps-1 pt-1">
              <label htmlFor="ai-custom-model" className="sr-only">
                {t("aiForm.model.customLabel")}
              </label>
              <Input
                id="ai-custom-model"
                value={customModel}
                onChange={(e) => {
                  setCustomModel(e.target.value);
                  setTest(null);
                }}
                placeholder="claude-opus-5-5"
                autoComplete="off"
                spellCheck={false}
                invalid={!!errors.model}
              />
            </div>
          )}
          {errors.model && (
            <p className="text-xs text-danger" role="alert">
              {errors.model}
            </p>
          )}
        </div>
      </SettingsSection>

      <SettingsSection title={t("aiForm.key.title")} description={t("aiForm.key.description")}>
        <div className="space-y-3 px-4 py-4 sm:px-5">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium text-ink">ANTHROPIC_API_KEY</span>
            {keyConfigured ? (
              <>
                <Badge tone="success" dot>
                  {t("aiForm.key.configured")}
                </Badge>
                <code className="rounded bg-surface-2 px-1.5 py-0.5 text-xs text-ink-muted">{keyHint}</code>
              </>
            ) : (
              <Badge tone="warning" dot>
                {t("aiForm.key.notSet")}
              </Badge>
            )}
          </div>
          {!keyConfigured && (
            <ol className="list-decimal space-y-1 ps-5 text-sm text-ink-muted">
              <li>{t("aiForm.key.step1")}</li>
              <li>
                {t.rich("aiForm.key.step2", {
                  setting: "ANTHROPIC_API_KEY=your-key",
                  file: ".env",
                  code: (chunks) => (
                    <code dir="ltr" className="rounded bg-surface-2 px-1 text-xs">
                      {chunks}
                    </code>
                  ),
                })}
              </li>
              <li>{t("aiForm.key.step3")}</li>
            </ol>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" variant="outline" size="sm" onClick={runTest} loading={testing} disabled={!keyConfigured || !model} leftIcon={<Icon.Zap className="size-4" />}>
              {t("aiForm.test.button")}
            </Button>
            <span className="text-xs text-ink-faint">{model ? t("aiForm.test.hint", { model }) : t("aiForm.test.hintNoModel")}</span>
          </div>
          <div aria-live="polite">
            {test?.ok === true && (
              <p className="flex items-start gap-2 rounded-lg border border-success/30 bg-success/8 px-3 py-2 text-sm text-ink">
                <Icon.CheckCircle className="mt-0.5 size-4 shrink-0 text-success" />
                <span>
                  {t.rich("aiForm.test.connected", {
                    model: test.result.model,
                    ms: f.number(test.result.latencyMs),
                    b: (chunks) => <strong className="font-medium">{chunks}</strong>,
                  })}
                </span>
              </p>
            )}
            {test?.ok === false && (
              <p className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/8 px-3 py-2 text-sm text-ink" role="alert">
                <Icon.AlertCircle className="mt-0.5 size-4 shrink-0 text-danger" />
                <span>{test.error}</span>
              </p>
            )}
          </div>
        </div>
      </SettingsSection>

      <SettingsSection title={t("aiForm.limits.title")}>
        <SettingsRow
          label={t("aiForm.limits.daily.label")}
          description={t("aiForm.limits.daily.description")}
          htmlFor="ai-daily-limit"
          error={errors.dailyMessageLimit}
        >
          <Input
            id="ai-daily-limit"
            name="dailyMessageLimit"
            type="number"
            inputMode="numeric"
            min={0}
            max={1000}
            step={1}
            defaultValue={initial.dailyMessageLimit}
            invalid={!!errors.dailyMessageLimit}
          />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title={t("aiForm.prompt.title")} description={t("aiForm.prompt.description")}>
        <SettingsRow
          stacked
          label={t("aiForm.prompt.label")}
          description={t("aiForm.prompt.hint")}
          htmlFor="ai-system-prompt"
          error={errors.systemPrompt}
        >
          <Textarea
            id="ai-system-prompt"
            name="systemPrompt"
            rows={5}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={t("aiForm.prompt.placeholder")}
            invalid={!!errors.systemPrompt || prompt.length > MAX_PROMPT_ADDITION_CHARS}
          />
          <p className={cn("mt-1 text-end text-xs tabular-nums", prompt.length > MAX_PROMPT_ADDITION_CHARS ? "text-danger" : "text-ink-faint")}>
            {f.number(prompt.length)}/{f.number(MAX_PROMPT_ADDITION_CHARS)}
          </p>
          <button
            type="button"
            onClick={() => setShowRules((v) => !v)}
            aria-expanded={showRules}
            aria-controls="ai-base-rules"
            className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline"
          >
            <Icon.ChevronDown className={cn("size-3.5 transition-transform", showRules && "rotate-180")} />
            {showRules ? t("aiForm.prompt.hideRules") : t("aiForm.prompt.showRules")}
          </button>
          {showRules && (
            <pre id="ai-base-rules" className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-surface-2 p-3 text-xs leading-relaxed text-ink-muted">
              {baseRules}
            </pre>
          )}
        </SettingsRow>
      </SettingsSection>

      <SaveBar dirty={dirty} pending={pending} saved={state?.ok} failed={state?.ok === false} />
    </form>
  );
}
