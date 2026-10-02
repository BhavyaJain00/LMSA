"use client";

import { startTransition, useActionState, useState, type ReactNode } from "react";
import { savePersonaAction } from "@/lib/actions/persona";
import { Button, IconButton } from "@/components/ui/button";
import { Icon, Spinner } from "@/components/ui/icons";
import { FormError } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type QuestionKey = "referrer" | "role" | "industry" | "goals";

interface Question {
  key: QuestionKey;
  title: string;
  subtitle: string;
  options: string[];
  multi?: boolean;
}

interface Outcome {
  label: string;
  description: string;
  href: string;
  icon: ReactNode;
}

export interface PersonaInitial {
  referrer?: string;
  role?: string;
  industry?: string;
  goals?: string[];
}

function withExisting(options: string[], existing: string[]): string[] {
  const extra = existing.filter((e) => e && !options.some((o) => o.toLowerCase() === e.toLowerCase()));
  return [...extra, ...options];
}

/**
 * Onboarding questionnaire: three single-choice steps, one multi-choice step,
 * then "Where do you want to start?". Single choices auto-advance; answers are
 * saved with the chosen starting point, or with "Skip for now".
 */
/** Feature flags that decide which starting points are offered. */
export interface PersonaFeatures {
  courses: boolean;
  batches: boolean;
  programs: boolean;
}

export function PersonaForm({
  brandName,
  username,
  initial,
  features,
}: {
  brandName: string;
  username: string;
  initial: PersonaInitial;
  features: PersonaFeatures;
}) {
  const [state, dispatch, pending] = useActionState(savePersonaAction, null);
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<QuestionKey, string[]>>({
    referrer: initial.referrer ? [initial.referrer] : [],
    role: initial.role ? [initial.role] : [],
    industry: initial.industry ? [initial.industry] : [],
    goals: initial.goals ?? [],
  });
  const [chosen, setChosen] = useState<string | null>(null);

  const questions: Question[] = [
    {
      key: "referrer",
      title: `How did you hear about ${brandName}?`,
      subtitle: "Your answers let us tailor what you learn next.",
      options: withExisting(
        [
          "Search engine (Google, etc.)",
          "Social media",
          "Friend or colleague",
          "YouTube",
          "Newsletter or blog",
          "My employer or school",
          "AI assistant (ChatGPT, etc.)",
          "Other",
        ],
        answers.referrer,
      ),
    },
    {
      key: "role",
      title: "What best describes you?",
      subtitle: "We'll suggest courses that fit where you are today.",
      options: withExisting(
        ["Student", "Career switcher", "Working professional", "Team lead or manager", "Teacher or trainer", "Founder or freelancer", "Hobbyist", "Other"],
        answers.role,
      ),
    },
    {
      key: "industry",
      title: "Which industry are you in?",
      subtitle: "Pick the closest match.",
      options: withExisting(
        [
          "Software",
          "Education",
          "Finance",
          "Healthcare",
          "Marketing and media",
          "Design and creative",
          "Manufacturing",
          "Retail and e-commerce",
          "Government or non-profit",
          "Other",
        ],
        answers.industry,
      ),
    },
    {
      key: "goals",
      title: "What do you want to achieve?",
      subtitle: "Choose as many as you like.",
      multi: true,
      options: withExisting(
        ["Get a job", "Build projects", "Learn a new skill", "Get certified", "Grow in my current role", "Start a business", "Teach others", "Just exploring"],
        answers.goals,
      ),
    },
  ];

  const outcomes: Outcome[] = [
    ...(features.courses
      ? [{ label: "Browse courses", description: "Find something new to learn.", href: "/courses", icon: <Icon.BookOpen className="size-5" /> }]
      : []),
    ...(features.batches
      ? [{ label: "Join a live batch", description: "Learn with a cohort and live classes.", href: "/batches", icon: <Icon.Users className="size-5" /> }]
      : []),
    ...(features.programs
      ? [{ label: "Follow a program", description: "A guided path of courses, in order.", href: "/programs", icon: <Icon.Layers className="size-5" /> }]
      : []),
    { label: "Complete my profile", description: "Add a photo, headline and skills.", href: `/user/${username}/edit`, icon: <Icon.User className="size-5" /> },
    { label: "Go to my dashboard", description: "See your streak and what's next.", href: "/dashboard", icon: <Icon.Home className="size-5" /> },
  ];

  const total = questions.length;
  const question = step < total ? questions[step]! : null;
  const answered = question ? answers[question.key].length > 0 : true;

  const submit = (intent: "save" | "skip", destination?: string) => {
    const fd = new FormData();
    fd.set("intent", intent);
    if (destination) fd.set("destination", destination);
    for (const key of ["referrer", "role", "industry"] as const) if (answers[key][0]) fd.set(key, answers[key][0]);
    for (const g of answers.goals) fd.append("goals", g);
    startTransition(() => dispatch(fd));
  };

  const pick = (q: Question, option: string) => {
    const current = answers[q.key];
    const selected = current.includes(option);
    if (q.multi) {
      setAnswers({ ...answers, [q.key]: selected ? current.filter((o) => o !== option) : [...current, option] });
      return;
    }
    setAnswers({ ...answers, [q.key]: selected ? [] : [option] });
    if (!selected) window.setTimeout(() => setStep((s) => Math.min(total, s + 1)), 180);
  };

  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-stretch pt-6 sm:pt-16">
      <div className="relative">
        {step > 0 && (
          <IconButton
            label="Back"
            size="icon-sm"
            className="absolute -top-10 left-0 sm:-left-12 sm:top-1"
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={pending}
          >
            <Icon.ChevronLeft className="size-5 rtl:rotate-180" />
          </IconButton>
        )}

        <div className="rounded-2xl border border-border bg-surface-1 p-6 shadow-card sm:p-7">
          <div className="mb-5 flex items-center justify-between gap-3">
            <span className="flex size-8 items-center justify-center rounded-lg bg-accent text-accent-fg">
              <Icon.GraduationCap className="size-5" />
            </span>
            <div className="flex items-center gap-1.5" aria-label={question ? `Step ${step + 1} of ${total}` : "Last step"}>
              {Array.from({ length: total + 1 }).map((_, i) => (
                <span key={i} className={cn("h-1.5 rounded-full transition-all", i === step ? "w-5 bg-accent" : i < step ? "w-1.5 bg-accent/60" : "w-1.5 bg-surface-3")} />
              ))}
            </div>
          </div>

          <div key={step} className="animate-fade-in">
            {question ? (
              <fieldset>
                <legend className="text-2xl font-bold tracking-tight text-ink">{question.title}</legend>
                <p className="mt-1 text-sm text-ink-muted">{question.subtitle}</p>
                <div className="mt-5 flex flex-wrap gap-2">
                  {question.options.map((option) => {
                    const selected = answers[question.key].includes(option);
                    return (
                      <button
                        key={option}
                        type="button"
                        aria-pressed={selected}
                        disabled={pending}
                        onClick={() => pick(question, option)}
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition-colors",
                          selected ? "border-accent bg-accent/10 font-medium text-accent" : "border-border-strong text-ink hover:bg-surface-2",
                        )}
                      >
                        {option}
                        {selected && <Icon.X className="size-3.5" aria-hidden="true" />}
                      </button>
                    );
                  })}
                </div>
                {state && !state.ok && state.fieldErrors?.[question.key] && <p className="mt-3 text-xs text-danger">{state.fieldErrors[question.key]}</p>}
                <Button className="mt-6 w-full" disabled={!answered || pending} onClick={() => setStep((s) => s + 1)}>
                  Next
                </Button>
              </fieldset>
            ) : (
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-ink">You&apos;re all set</h1>
                <p className="mt-1 text-sm text-ink-muted">Where do you want to start?</p>
                <FormError message={state && !state.ok ? state.error : null} />
                <ul className="mt-5 space-y-2">
                  {outcomes.map((o) => (
                    <li key={o.href}>
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => {
                          setChosen(o.href);
                          submit("save", o.href);
                        }}
                        className="flex w-full items-center gap-3 rounded-xl border border-border p-3 text-left transition-colors hover:border-border-strong hover:bg-surface-2 disabled:opacity-60"
                      >
                        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-ink-muted">{o.icon}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium text-ink">{o.label}</span>
                          <span className="block text-xs text-ink-muted">{o.description}</span>
                        </span>
                        {pending && chosen === o.href ? (
                          <Spinner className="size-4 text-ink-muted" />
                        ) : (
                          <Icon.ChevronRight className="size-4 text-ink-faint rtl:rotate-180" />
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="mt-8 text-center">
        <Button variant="ghost" size="sm" disabled={pending} onClick={() => submit("skip")} className="text-ink-muted">
          Skip for now
        </Button>
      </div>
    </div>
  );
}
