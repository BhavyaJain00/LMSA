/**
 * Claude models offered in Admin → Settings → AI tutor (client-safe).
 *
 * Prices are US dollars per million tokens on the Anthropic API and are only
 * used for the "estimated cost" figure on the usage dashboard.
 */

export interface AiModelOption {
  id: string;
  label: string;
  note: string;
  inputPerMillion: number;
  outputPerMillion: number;
}

export const DEFAULT_AI_MODEL = "claude-opus-5-5";

export const AI_MODEL_OPTIONS: AiModelOption[] = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5", note: "Recommended: most capable Opus model", inputPerMillion: 4, outputPerMillion: 20 },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", note: "Faster replies at half the cost", inputPerMillion: 2, outputPerMillion: 10 },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", note: "Fastest and lowest cost", inputPerMillion: 1, outputPerMillion: 5 },
  { id: "claude-fable-5-1", label: "Claude Fable 5.1", note: "Most capable model, highest cost", inputPerMillion: 10, outputPerMillion: 50 },
  { id: "claude-opus-5", label: "Claude Opus 5", note: "Previous Opus model", inputPerMillion: 5, outputPerMillion: 25 },
  { id: "claude-sonnet-5", label: "Claude Sonnet 5", note: "Previous Sonnet model", inputPerMillion: 2, outputPerMillion: 10 },
];

/** Model ids look like "claude-opus-5-5"; anything else is rejected before reaching the API. */
export const MODEL_ID_RE = /^[a-z0-9][a-z0-9.-]{2,63}$/;

export function isValidModelId(id: string): boolean {
  return MODEL_ID_RE.test(id);
}

/** Models that accept `output_config.effort` (Haiku 4.5 and older models reject it). */
export function supportsEffort(model: string): boolean {
  return /^claude-(opus|sonnet|fable|mythos)-(5|4-[678])(\b|-)/.test(model);
}

/** Models that accept server-side refusal fallbacks with `fallbacks: "default"`. */
export function supportsDefaultFallback(model: string): boolean {
  return ["claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5", "claude-fable-5-1"].includes(model);
}

/** Estimated API cost in US dollars, or null for models without a known price. */
export function estimateCostUsd(model: string, tokensIn: number, tokensOut: number): number | null {
  const option = AI_MODEL_OPTIONS.find((m) => m.id === model);
  if (!option) return null;
  return (tokensIn * option.inputPerMillion + tokensOut * option.outputPerMillion) / 1_000_000;
}
