import type { Rubric, RubricCriterion, RubricLevel, RubricScore } from "@/lib/types";

/**
 * Rubric rules shared by the server (validation, grading) and the client
 * (grid editor, scorer). No runtime imports beyond types: safe everywhere.
 *
 * A rubric is a grid of criteria (rows) × performance levels (columns). Each
 * level is worth some points; a criterion is worth the points of its best
 * level, and the rubric's maximum is the sum over criteria. A graded
 * submission passes when its total reaches `passPercent` of that maximum.
 */

export const RUBRIC_LIMITS = {
  titleMax: 120,
  criteriaMin: 1,
  criteriaMax: 20,
  criterionTitleMax: 120,
  criterionDescriptionMax: 500,
  levelsMin: 2,
  levelsMax: 8,
  levelLabelMax: 60,
  levelDescriptionMax: 300,
  pointsMax: 1000,
  commentMax: 2000,
} as const;

/** Round to two decimals (points may be fractional, e.g. 2.5). */
export function roundPoints(value: number): number {
  return Math.round(value * 100) / 100;
}

/** "3" or "2.5" — no trailing zeros. */
export function formatPoints(value: number): string {
  const rounded = roundPoints(value);
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

/** Best level of a criterion (levels may be authored in any order). */
export function criterionMaxPoints(criterion: Pick<RubricCriterion, "levels">): number {
  let max = 0;
  for (const level of criterion.levels) if (Number.isFinite(level.points) && level.points > max) max = level.points;
  return max;
}

export function rubricMaxPoints(rubric: Pick<Rubric, "criteria">): number {
  return roundPoints(rubric.criteria.reduce((total, c) => total + criterionMaxPoints(c), 0));
}

/** Percent of `max` reached by `total`, one decimal. */
export function scorePercent(total: number, max: number): number {
  if (max <= 0) return 0;
  return Math.round((total / max) * 1000) / 10;
}

/**
 * Pass check without floating-point drift: 7 of 10 points passes a 70 %
 * threshold even though 7 / 10 * 100 is 70.00000000000001 in binary.
 */
export function meetsThreshold(total: number, max: number, passPercent: number): boolean {
  if (max <= 0) return false;
  return total * 100 + 1e-9 >= passPercent * max;
}

/** Points needed to pass, e.g. 14 of 20 at 70 %. */
export function pointsToPass(max: number, passPercent: number): number {
  return roundPoints((max * passPercent) / 100);
}

export interface RubricSelection {
  criterionId: string;
  levelIndex: number;
  comment?: string;
}

export interface RubricResult {
  /** One score per criterion that has a valid selection, in rubric order. */
  scores: RubricScore[];
  total: number;
  max: number;
  percent: number;
  passed: boolean;
  /** Every criterion has a level selected. */
  complete: boolean;
  /** Criterion ids without a (valid) selection. */
  missing: string[];
}

/**
 * Score a set of selections against a rubric. Unknown criteria and
 * out-of-range levels are ignored (reported as missing); points always come
 * from the rubric, never from the client.
 */
export function scoreRubric(rubric: Pick<Rubric, "criteria" | "passPercent">, selections: readonly RubricSelection[]): RubricResult {
  const byCriterion = new Map<string, RubricSelection>();
  for (const s of selections) if (s && typeof s.criterionId === "string") byCriterion.set(s.criterionId, s);
  const scores: RubricScore[] = [];
  const missing: string[] = [];
  let total = 0;
  for (const criterion of rubric.criteria) {
    const pick = byCriterion.get(criterion.id);
    const level = pick && Number.isInteger(pick.levelIndex) ? criterion.levels[pick.levelIndex] : undefined;
    if (!pick || !level) {
      missing.push(criterion.id);
      continue;
    }
    const comment = typeof pick.comment === "string" ? pick.comment.trim().slice(0, RUBRIC_LIMITS.commentMax) : "";
    scores.push({ criterionId: criterion.id, levelIndex: pick.levelIndex, points: level.points, ...(comment ? { comment } : {}) });
    total += level.points;
  }
  const max = rubricMaxPoints(rubric);
  total = roundPoints(total);
  const complete = missing.length === 0 && rubric.criteria.length > 0;
  return { scores, total, max, percent: scorePercent(total, max), passed: complete && meetsThreshold(total, max, rubric.passPercent), complete, missing };
}

/** Total of stored scores (points were snapshotted when graded). */
export function totalOfScores(scores: readonly RubricScore[] | undefined): number {
  return roundPoints((scores ?? []).reduce((t, s) => t + (Number.isFinite(s.points) ? s.points : 0), 0));
}

export interface CriterionAverage {
  criterionId: string;
  /** Average points over the score sets that rated this criterion. */
  average: number;
  count: number;
}

export interface ScoreAverage {
  criteria: CriterionAverage[];
  /** Sum of the per-criterion averages. */
  total: number;
  max: number;
  percent: number;
  /** Number of score sets averaged. */
  count: number;
}

/** Average several scored rubrics (e.g. the peer reviews of one submission). */
export function averageScores(rubric: Pick<Rubric, "criteria">, sets: readonly (readonly RubricScore[] | undefined)[]): ScoreAverage {
  const used = sets.filter((s): s is readonly RubricScore[] => Array.isArray(s) && s.length > 0);
  const criteria: CriterionAverage[] = rubric.criteria.map((c) => {
    const points = used.map((set) => set.find((s) => s.criterionId === c.id)?.points).filter((p): p is number => typeof p === "number" && Number.isFinite(p));
    return { criterionId: c.id, average: points.length ? roundPoints(points.reduce((a, b) => a + b, 0) / points.length) : 0, count: points.length };
  });
  const total = roundPoints(criteria.reduce((t, c) => t + c.average, 0));
  const max = rubricMaxPoints(rubric);
  return { criteria, total, max, percent: scorePercent(total, max), count: used.length };
}

/** Level of a criterion whose points are closest to `points` (to pre-select a level from an average). */
export function nearestLevelIndex(criterion: Pick<RubricCriterion, "levels">, points: number): number {
  let best = -1;
  let bestDiff = Infinity;
  criterion.levels.forEach((level, i) => {
    const diff = Math.abs(level.points - points);
    if (diff < bestDiff || (diff === bestDiff && best >= 0 && level.points > criterion.levels[best]!.points)) {
      best = i;
      bestDiff = diff;
    }
  });
  return best;
}

/* ------------------------------------------------------------------ */
/* Validation of the editor payload                                    */
/* ------------------------------------------------------------------ */

export interface RubricInput {
  title: string;
  passPercent: number;
  criteria: RubricCriterion[];
}

export type RubricValidation = { ok: true; value: RubricInput } | { ok: false; error: string; fieldErrors: Record<string, string> };

const ID_PATTERN = /^[a-z0-9_]{3,40}$/;

function str(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function multiline(value: unknown): string {
  return typeof value === "string" ? value.replace(/\r\n?/g, "\n").trim() : "";
}

function num(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") return Number(value);
  return Number.NaN;
}

/**
 * Validate and normalize a rubric sent by the grid editor. Criterion ids are
 * kept when well-formed and unique (so saved scores keep pointing at the same
 * row after an edit) and minted with `makeId` otherwise.
 */
export function validateRubricInput(raw: { title: unknown; passPercent: unknown; criteria: unknown }, makeId: () => string): RubricValidation {
  const fieldErrors: Record<string, string> = {};
  const title = str(raw.title);
  if (!title) fieldErrors.title = "Give the rubric a title.";
  else if (title.length > RUBRIC_LIMITS.titleMax) fieldErrors.title = `Keep the title under ${RUBRIC_LIMITS.titleMax} characters.`;

  const passPercent = num(raw.passPercent);
  if (!Number.isFinite(passPercent) || passPercent < 0 || passPercent > 100) fieldErrors.passPercent = "Enter a pass mark between 0 and 100 %.";

  const list = Array.isArray(raw.criteria) ? raw.criteria : [];
  if (list.length < RUBRIC_LIMITS.criteriaMin) fieldErrors.criteria = "Add at least one criterion.";
  else if (list.length > RUBRIC_LIMITS.criteriaMax) fieldErrors.criteria = `A rubric can have up to ${RUBRIC_LIMITS.criteriaMax} criteria.`;

  const seen = new Set<string>();
  const criteria: RubricCriterion[] = [];
  list.slice(0, RUBRIC_LIMITS.criteriaMax).forEach((item, ci) => {
    const c = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const key = `criteria.${ci}`;
    const cTitle = str(c.title);
    const description = multiline(c.description);
    if (!cTitle) fieldErrors[`${key}.title`] = `Name criterion ${ci + 1}.`;
    else if (cTitle.length > RUBRIC_LIMITS.criterionTitleMax) fieldErrors[`${key}.title`] = "This criterion name is too long.";
    if (description.length > RUBRIC_LIMITS.criterionDescriptionMax) fieldErrors[`${key}.description`] = "This description is too long.";

    const rawLevels = Array.isArray(c.levels) ? c.levels : [];
    if (rawLevels.length < RUBRIC_LIMITS.levelsMin) fieldErrors[`${key}.levels`] = `Criterion ${ci + 1} needs at least ${RUBRIC_LIMITS.levelsMin} levels.`;
    else if (rawLevels.length > RUBRIC_LIMITS.levelsMax) fieldErrors[`${key}.levels`] = `Use at most ${RUBRIC_LIMITS.levelsMax} levels per criterion.`;

    const levels: RubricLevel[] = [];
    rawLevels.slice(0, RUBRIC_LIMITS.levelsMax).forEach((lv, li) => {
      const l = (lv && typeof lv === "object" ? lv : {}) as Record<string, unknown>;
      const lKey = `${key}.levels.${li}`;
      const label = str(l.label);
      const points = num(l.points);
      const lDescription = multiline(l.description);
      if (!label) fieldErrors[`${lKey}.label`] = "Name this level.";
      else if (label.length > RUBRIC_LIMITS.levelLabelMax) fieldErrors[`${lKey}.label`] = "This level name is too long.";
      if (!Number.isFinite(points) || points < 0 || points > RUBRIC_LIMITS.pointsMax) fieldErrors[`${lKey}.points`] = `Points must be between 0 and ${RUBRIC_LIMITS.pointsMax}.`;
      if (lDescription.length > RUBRIC_LIMITS.levelDescriptionMax) fieldErrors[`${lKey}.description`] = "This description is too long.";
      levels.push({ label, points: Number.isFinite(points) ? roundPoints(points) : 0, ...(lDescription ? { description: lDescription } : {}) });
    });
    if (levels.length >= RUBRIC_LIMITS.levelsMin && levels.every((l) => l.points === 0) && !fieldErrors[`${key}.levels`]) {
      fieldErrors[`${key}.levels`] = `Give at least one level of criterion ${ci + 1} some points.`;
    }

    const rawId = typeof c.id === "string" ? c.id : "";
    const id = ID_PATTERN.test(rawId) && !seen.has(rawId) ? rawId : makeId();
    seen.add(id);
    criteria.push({ id, title: cTitle, ...(description ? { description } : {}), levels });
  });

  const keys = Object.keys(fieldErrors);
  if (keys.length) return { ok: false, error: fieldErrors[keys[0]!]!, fieldErrors };
  return { ok: true, value: { title, passPercent: Math.round(passPercent * 10) / 10, criteria } };
}

/** Deep copy of criteria with fresh ids (duplicate a rubric or start from a template). */
export function cloneCriteria(criteria: readonly RubricCriterion[], makeId: () => string): RubricCriterion[] {
  return criteria.map((c) => ({
    id: makeId(),
    title: c.title,
    ...(c.description ? { description: c.description } : {}),
    levels: c.levels.map((l) => ({ label: l.label, points: l.points, ...(l.description ? { description: l.description } : {}) })),
  }));
}

/* ------------------------------------------------------------------ */
/* Starter templates                                                   */
/* ------------------------------------------------------------------ */

export interface RubricTemplate {
  key: string;
  title: string;
  summary: string;
  passPercent: number;
  criteria: Omit<RubricCriterion, "id">[];
}

const fourLevels = (descriptions: [string, string, string, string]): RubricLevel[] => [
  { label: "Beginning", points: 1, description: descriptions[0] },
  { label: "Developing", points: 2, description: descriptions[1] },
  { label: "Proficient", points: 3, description: descriptions[2] },
  { label: "Exemplary", points: 4, description: descriptions[3] },
];

export const RUBRIC_TEMPLATES: readonly RubricTemplate[] = [
  {
    key: "written",
    title: "Written response",
    summary: "Essays, reflections and short reports.",
    passPercent: 60,
    criteria: [
      {
        title: "Understanding",
        description: "Shows a correct grasp of the ideas the task is about.",
        levels: fourLevels([
          "Key ideas are missing or misunderstood.",
          "Some ideas are right, others are shaky.",
          "Ideas are accurate and clearly explained.",
          "Ideas are accurate, connected and go beyond the lesson.",
        ]),
      },
      {
        title: "Evidence and examples",
        description: "Supports claims with examples, data or sources.",
        levels: fourLevels([
          "Claims have no support.",
          "Some support, but thin or loosely related.",
          "Relevant support for the main claims.",
          "Well-chosen support for every claim.",
        ]),
      },
      {
        title: "Organization",
        description: "The response is easy to follow from start to finish.",
        levels: fourLevels(["Hard to follow.", "Order is sometimes unclear.", "Logical order with clear sections.", "Flows naturally; each part builds on the last."]),
      },
      {
        title: "Writing quality",
        description: "Grammar, spelling and word choice.",
        levels: fourLevels(["Frequent errors get in the way.", "Noticeable errors, meaning still clear.", "Few errors.", "Polished and precise."]),
      },
    ],
  },
  {
    key: "project",
    title: "Project",
    summary: "Build tasks: apps, designs, models or prototypes.",
    passPercent: 70,
    criteria: [
      {
        title: "Requirements",
        description: "Delivers what the brief asks for.",
        levels: [
          { label: "Missing", points: 0, description: "Most requirements are not met." },
          { label: "Partial", points: 3, description: "Some requirements are met." },
          { label: "Complete", points: 6, description: "Every requirement is met." },
          { label: "Extended", points: 8, description: "Every requirement is met, with thoughtful extras." },
        ],
      },
      {
        title: "Quality of work",
        description: "Correctness, robustness and attention to detail.",
        levels: [
          { label: "Needs work", points: 1, description: "Breaks often or is unfinished." },
          { label: "Acceptable", points: 3, description: "Works for the main cases." },
          { label: "Strong", points: 5, description: "Works reliably, including edge cases." },
        ],
      },
      {
        title: "Explanation",
        description: "Explains the approach and the choices made.",
        levels: [
          { label: "None", points: 0, description: "No explanation." },
          { label: "Brief", points: 2, description: "Describes what was done." },
          { label: "Clear", points: 4, description: "Explains what was done and why." },
        ],
      },
    ],
  },
  {
    key: "presentation",
    title: "Presentation",
    summary: "Recorded talks, demos and slide decks.",
    passPercent: 65,
    criteria: [
      {
        title: "Content",
        levels: fourLevels(["Off-topic or inaccurate.", "On topic with gaps.", "Accurate and complete.", "Insightful and well researched."]),
      },
      {
        title: "Structure",
        levels: fourLevels(["No clear beginning or end.", "Some structure.", "Clear introduction, body and close.", "Memorable arc that keeps attention."]),
      },
      {
        title: "Delivery",
        levels: fourLevels(["Hard to hear or follow.", "Understandable but hesitant.", "Clear and confident.", "Engaging and well paced."]),
      },
      {
        title: "Visuals",
        levels: fourLevels(["Distracting or missing.", "Cluttered in places.", "Clean and supportive.", "Visuals make the ideas clearer."]),
      },
    ],
  },
];

export function findRubricTemplate(key: string | undefined | null): RubricTemplate | null {
  return RUBRIC_TEMPLATES.find((t) => t.key === key) ?? null;
}
