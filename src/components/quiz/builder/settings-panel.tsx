"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { Field, Input, Select, Switch, Textarea, type InputProps } from "@/components/ui/input";
import { Icon } from "@/components/ui/icons";
import { formatScore, type CourseOption, type QuizEditorData, type QuizSettingsInput } from "../types";
import { useHydrated } from "../local-time";
import { isoToLocalInput, localInputToIso } from "./hooks";

/** Number input that keeps what the user typed (e.g. an empty field) while reporting numbers (NaN when empty). */
function NumberInput({ value, onChange, ...props }: Omit<InputProps, "value" | "onChange" | "type"> & { value: number; onChange: (n: number) => void }) {
  const [text, setText] = useState(Number.isFinite(value) ? String(value) : "");
  const [prev, setPrev] = useState(value);
  if (!Object.is(value, prev)) {
    setPrev(value);
    const parsed = text.trim() === "" ? NaN : Number(text);
    if (!Object.is(parsed, value)) setText(Number.isFinite(value) ? String(value) : "");
  }
  return (
    <Input
      type="number"
      inputMode="decimal"
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        onChange(e.target.value.trim() === "" ? NaN : Number(e.target.value));
      }}
      {...props}
    />
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-4">
      <h2 className="text-sm font-semibold text-ink">{title}</h2>
      {children}
    </section>
  );
}

function Nested({ children }: { children: ReactNode }) {
  return <div className="ml-1 border-l-2 border-border pl-4 animate-fade-in">{children}</div>;
}

export interface SettingsPanelProps {
  settings: QuizSettingsInput;
  onChange: (patch: Partial<QuizSettingsInput>) => void;
  errors: Record<string, string>;
  questionCount: number;
  totalMarks: number;
  courses: CourseOption[];
  hasOpenEnded: boolean;
  placements: QuizEditorData["placements"];
}

/** The builder's right-hand "Details" and "Settings" panel. */
export function SettingsPanel({ settings: s, onChange, errors, questionCount, totalMarks, courses, hasOpenEnded, placements }: SettingsPanelProps) {
  const hydrated = useHydrated();
  return (
    <div className="space-y-8">
      <Section title="Details">
        <Field label="Title" htmlFor="qb-title" required error={errors.title}>
          <Input id="qb-title" value={s.title} onChange={(e) => onChange({ title: e.target.value })} maxLength={200} invalid={!!errors.title} />
        </Field>
        <Field label="Instructions" htmlFor="qb-description" error={errors.description} hint="Optional. Markdown shown on the quiz's start card.">
          <Textarea
            id="qb-description"
            rows={3}
            value={s.description}
            onChange={(e) => onChange({ description: e.target.value })}
            maxLength={5000}
            placeholder="What should learners know before they start?"
            invalid={!!errors.description}
          />
        </Field>
        <Field label="Course" htmlFor="qb-course" error={errors.courseId} hint="Lessons that embed this quiz link it to their course automatically.">
          <Select id="qb-course" value={s.courseId} onChange={(e) => onChange({ courseId: e.target.value })} invalid={!!errors.courseId}>
            <option value="">No course</option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Maximum Attempts" htmlFor="qb-attempts" error={errors.maxAttempts} hint="0 = unlimited">
            <NumberInput id="qb-attempts" min={0} step={1} value={s.maxAttempts} onChange={(n) => onChange({ maxAttempts: n })} invalid={!!errors.maxAttempts} />
          </Field>
          <Field label="Duration (in minutes)" htmlFor="qb-duration" error={errors.durationMinutes} hint="0 = no time limit">
            <NumberInput id="qb-duration" min={0} step={1} value={s.durationMinutes} onChange={(n) => onChange({ durationMinutes: n })} invalid={!!errors.durationMinutes} />
          </Field>
        </div>
        <Field label="Passing Percentage" htmlFor="qb-passing" required error={errors.passingPercentage}>
          <NumberInput
            id="qb-passing"
            min={0}
            max={100}
            step={1}
            value={s.passingPercentage}
            onChange={(n) => onChange({ passingPercentage: n })}
            rightAddon={<span className="text-sm">%</span>}
            invalid={!!errors.passingPercentage}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Total Questions" htmlFor="qb-total-q" hint={s.shuffleQuestions && s.limitQuestionsTo > 0 && s.limitQuestionsTo < questionCount ? `${s.limitQuestionsTo} per attempt` : undefined}>
            <Input id="qb-total-q" value={String(questionCount)} disabled readOnly />
          </Field>
          <Field label="Total Marks" htmlFor="qb-total-m">
            <Input id="qb-total-m" value={formatScore(totalMarks)} disabled readOnly />
          </Field>
        </div>
      </Section>

      <Section title="Settings">
        <div className="space-y-4">
          <Switch
            id="qb-show-answers"
            label="Show Answers"
            description={
              hasOpenEnded
                ? "Not available for open-ended quizzes: you grade the answers after submission."
                : "Display correct answers after each question is attempted."
            }
            checked={s.showAnswers && !hasOpenEnded}
            disabled={hasOpenEnded}
            onChange={(e) => onChange({ showAnswers: e.target.checked })}
          />
          <Switch
            id="qb-history"
            label="Show Submission History"
            description="Allow users to view their past quiz attempts."
            checked={s.showSubmissionHistory}
            onChange={(e) => onChange({ showSubmissionHistory: e.target.checked })}
          />
          <Switch
            id="qb-shuffle"
            label="Shuffle Questions"
            description="Randomize the order of questions for each attempt."
            checked={s.shuffleQuestions}
            onChange={(e) => onChange({ shuffleQuestions: e.target.checked })}
          />
          {s.shuffleQuestions && (
            <Nested>
              <Field label="Limit Questions To" htmlFor="qb-limit" error={errors.limitQuestionsTo} hint="0 = every question. Otherwise each attempt picks this many at random (all questions must carry the same marks).">
                <NumberInput id="qb-limit" min={0} step={1} value={s.limitQuestionsTo} onChange={(n) => onChange({ limitQuestionsTo: n })} invalid={!!errors.limitQuestionsTo} />
              </Field>
            </Nested>
          )}
          <Switch
            id="qb-negative"
            label="Enable Negative Marking"
            description="Deduct marks for incorrect answers."
            checked={s.enableNegativeMarking}
            onChange={(e) => onChange({ enableNegativeMarking: e.target.checked, marksToCut: Number.isFinite(s.marksToCut) && s.marksToCut > 0 ? s.marksToCut : 1 })}
          />
          {s.enableNegativeMarking && (
            <Nested>
              <Field label="Marks to Deduct" htmlFor="qb-cut" required error={errors.marksToCut} hint="Taken off for each wrong answer. Unanswered questions aren't penalised.">
                <NumberInput id="qb-cut" min={0.25} step={0.25} value={s.marksToCut} onChange={(n) => onChange({ marksToCut: n })} invalid={!!errors.marksToCut} />
              </Field>
            </Nested>
          )}
          <Switch
            id="qb-proctoring"
            label="Enable Proctoring"
            description="Open the quiz in fullscreen and flag tab switches, focus loss and copy/paste."
            checked={s.enableProctoring}
            onChange={(e) =>
              onChange({ enableProctoring: e.target.checked, maxViolations: Number.isInteger(s.maxViolations) && s.maxViolations > 0 ? s.maxViolations : 3 })
            }
          />
          {s.enableProctoring && (
            <Nested>
              <Field label="Max Violations" htmlFor="qb-violations" required error={errors.maxViolations} hint="Quiz auto-submits when this many violations are recorded.">
                <NumberInput id="qb-violations" min={1} max={50} step={1} value={s.maxViolations} onChange={(n) => onChange({ maxViolations: n })} invalid={!!errors.maxViolations} />
              </Field>
            </Nested>
          )}
          <Switch
            id="qb-schedule"
            label="Enable Scheduling"
            description="Restrict when learners can start and submit this quiz."
            checked={s.enableScheduling}
            onChange={(e) => onChange({ enableScheduling: e.target.checked })}
          />
          {s.enableScheduling && (
            <Nested>
              <div className="space-y-3">
                <Field label="Schedule Start" htmlFor="qb-start" required error={errors.scheduleStart}>
                  <Input
                    id="qb-start"
                    type="datetime-local"
                    value={hydrated ? isoToLocalInput(s.scheduleStart) : ""}
                    disabled={!hydrated}
                    onChange={(e) => onChange({ scheduleStart: localInputToIso(e.target.value) })}
                    invalid={!!errors.scheduleStart}
                  />
                </Field>
                <Field label="Schedule End" htmlFor="qb-end" error={errors.scheduleEnd} hint="Optional. Leave empty to keep the quiz open after it starts.">
                  <Input
                    id="qb-end"
                    type="datetime-local"
                    value={hydrated ? isoToLocalInput(s.scheduleEnd) : ""}
                    disabled={!hydrated}
                    onChange={(e) => onChange({ scheduleEnd: localInputToIso(e.target.value) })}
                    invalid={!!errors.scheduleEnd}
                  />
                </Field>
                <p className="text-xs text-ink-muted">Times are in your timezone ({hydrated ? Intl.DateTimeFormat().resolvedOptions().timeZone : "local"}).</p>
              </div>
            </Nested>
          )}
        </div>
      </Section>

      <Section title="Used in">
        {placements.length === 0 ? (
          <p className="text-sm text-ink-muted">Not embedded in any lesson yet. Add it to a lesson from the course&apos;s lesson editor.</p>
        ) : (
          <ul className="space-y-2">
            {placements.map((p, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <Icon.BookOpen className="mt-0.5 size-4 shrink-0 text-ink-faint" />
                <span className="min-w-0">
                  {p.href ? (
                    <Link href={p.href} className="block truncate font-medium text-ink hover:underline">
                      {p.lessonTitle}
                    </Link>
                  ) : (
                    <span className="block truncate font-medium text-ink">{p.lessonTitle}</span>
                  )}
                  {p.courseTitle && <span className="block truncate text-xs text-ink-muted">{p.courseTitle}</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
