"use client";

import { useId, useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, Input, RadioCard, Select } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/tabs";
import { Icon } from "@/components/ui/icons";
import { formatTimeInput, parseOffsetInput } from "@/lib/transcripts/editor-state";

export type TimingChange = { kind: "shift"; offset: number; from: number; to: number } | { kind: "scale"; factor: number };

type Scope = "all" | "selected" | "from";

const FRAME_RATES: { value: string; label: string; factor: number }[] = [
  { value: "23.976-25", label: "Made at 23.976 fps, video is 25 fps", factor: 23.976 / 25 },
  { value: "25-23.976", label: "Made at 25 fps, video is 23.976 fps", factor: 25 / 23.976 },
  { value: "24-25", label: "Made at 24 fps, video is 25 fps", factor: 24 / 25 },
  { value: "25-24", label: "Made at 25 fps, video is 24 fps", factor: 25 / 24 },
  { value: "29.97-30", label: "Made at 29.97 fps, video is 30 fps", factor: 29.97 / 30 },
  { value: "30-29.97", label: "Made at 30 fps, video is 29.97 fps", factor: 30 / 29.97 },
];

/**
 * Move captions in time: by an offset (all, the selected run, or from one
 * caption onward), so that a caption starts at the playhead, or stretched
 * to fix a frame-rate mismatch.
 */
export function ShiftDialog({
  open,
  onClose,
  count,
  selection,
  focusIndex,
  playhead,
  cueStart,
  onApply,
}: {
  open: boolean;
  onClose: () => void;
  count: number;
  /** Selected indices, sorted. */
  selection: readonly number[];
  /** Caption the "from" scope starts at by default (the focused/active one). */
  focusIndex: number;
  playhead: number;
  /** Start time of caption `i`. */
  cueStart: (index: number) => number | null;
  onApply: (change: TimingChange) => void;
}) {
  const id = useId();
  const [tab, setTab] = useState<"shift" | "stretch">("shift");
  const [scope, setScope] = useState<Scope>(selection.length ? "selected" : "all");
  const [fromText, setFromText] = useState(String(Math.max(1, focusIndex + 1)));
  const [offsetText, setOffsetText] = useState("");
  const [rate, setRate] = useState(FRAME_RATES[0]!.value);

  const fromNumber = Number(fromText);
  const fromValid = Number.isInteger(fromNumber) && fromNumber >= 1 && fromNumber <= count;
  const range =
    scope === "selected" && selection.length
      ? { from: selection[0]!, to: selection[selection.length - 1]! }
      : scope === "from"
        ? { from: fromValid ? fromNumber - 1 : 0, to: count - 1 }
        : { from: 0, to: count - 1 };
  const offset = offsetText.trim() ? parseOffsetInput(offsetText) : null;
  const firstStart = cueStart(range.from);

  const alignToPlayhead = () => {
    if (firstStart === null) return;
    const delta = Math.round((playhead - firstStart) * 1000) / 1000;
    setOffsetText(`${delta >= 0 ? "+" : "-"}${formatTimeInput(Math.abs(delta))}`);
  };

  const apply = () => {
    if (tab === "stretch") {
      const factor = FRAME_RATES.find((r) => r.value === rate)?.factor;
      if (factor) onApply({ kind: "scale", factor });
      return;
    }
    if (offset === null || offset === 0) return;
    onApply({ kind: "shift", offset, ...range });
  };

  const scopeCount = range.to - range.from + 1;
  const canApply = tab === "stretch" || (offset !== null && offset !== 0 && (scope !== "from" || fromValid));

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Adjust timing"
      description="Fix captions that appear too early or too late."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={apply} disabled={!canApply} leftIcon={<Icon.Timer className="size-4" />}>
            {tab === "stretch" ? "Stretch all captions" : `Move ${scopeCount.toLocaleString("en-US")} ${scopeCount === 1 ? "caption" : "captions"}`}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <SegmentedControl
          size="md"
          value={tab}
          onChange={setTab}
          options={[
            { value: "shift", label: "Shift" },
            { value: "stretch", label: "Frame rate" },
          ]}
        />

        {tab === "shift" ? (
          <>
            <fieldset className="grid gap-2 sm:grid-cols-3">
              <legend className="mb-1.5 text-sm font-medium text-ink">Which captions</legend>
              <RadioCard name={`${id}-scope`} value="all" checked={scope === "all"} onChange={() => setScope("all")} title="All" description={`${count.toLocaleString("en-US")} captions`} />
              <RadioCard
                name={`${id}-scope`}
                value="selected"
                checked={scope === "selected"}
                onChange={() => setScope("selected")}
                disabled={!selection.length}
                title="Selected"
                description={selection.length ? `Captions ${selection[0]! + 1}–${selection[selection.length - 1]! + 1}` : "Select captions first"}
              />
              <RadioCard name={`${id}-scope`} value="from" checked={scope === "from"} onChange={() => setScope("from")} title="From a caption on" description="Everything after an edit point" />
            </fieldset>

            {scope === "from" && (
              <Field label="Starting at caption number" htmlFor={`${id}-from`} error={fromValid ? undefined : `Enter a number from 1 to ${count}.`}>
                <Input id={`${id}-from`} value={fromText} onChange={(e) => setFromText(e.target.value)} inputMode="numeric" invalid={!fromValid} className="max-w-32" />
              </Field>
            )}

            <Field
              label="Move by"
              htmlFor={`${id}-offset`}
              hint="Positive moves captions later, negative earlier: e.g. +1.5, -0.250 or -1:02.000."
              error={offsetText.trim() && offset === null ? "Enter a time such as +1.5 or -0:00.250." : undefined}
            >
              <div className="flex flex-wrap items-center gap-2">
                <Input id={`${id}-offset`} value={offsetText} onChange={(e) => setOffsetText(e.target.value)} placeholder="+0.500" inputMode="decimal" className="max-w-40 font-mono" invalid={!!offsetText.trim() && offset === null} />
                {firstStart !== null && (
                  <Button variant="outline" size="sm" onClick={alignToPlayhead}>
                    Start caption {range.from + 1} at the playhead ({formatTimeInput(playhead)})
                  </Button>
                )}
              </div>
            </Field>
          </>
        ) : (
          <Field label="The captions drift further off as the video plays because they were made for another frame rate" htmlFor={`${id}-rate`}>
            <Select id={`${id}-rate`} value={rate} onChange={(e) => setRate(e.target.value)}>
              {FRAME_RATES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <p className="text-xs text-ink-muted">You can undo this with Ctrl+Z.</p>
      </div>
    </Dialog>
  );
}
