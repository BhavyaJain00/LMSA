import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Rubric } from "@/lib/types";
import {
  RUBRIC_LIMITS,
  RUBRIC_TEMPLATES,
  averageScores,
  cloneCriteria,
  criterionMaxPoints,
  findRubricTemplate,
  formatPoints,
  meetsThreshold,
  nearestLevelIndex,
  pointsToPass,
  rubricMaxPoints,
  scorePercent,
  scoreRubric,
  totalOfScores,
  validateRubricInput,
} from "@/lib/teaching/rubric-shared";

/** Rubric scoring, the pass threshold and validation of the grid editor payload. */

const rubric: Pick<Rubric, "criteria" | "passPercent"> = {
  passPercent: 70,
  criteria: [
    {
      id: "crit_clarity",
      title: "Clarity",
      levels: [
        { label: "Weak", points: 0 },
        { label: "Fair", points: 2 },
        { label: "Strong", points: 4 },
      ],
    },
    {
      id: "crit_depth",
      title: "Depth",
      // Authored from best to worst: the maximum is still the best level.
      levels: [
        { label: "Deep", points: 6 },
        { label: "Shallow", points: 1 },
      ],
    },
  ],
};

let minted = 0;
const makeId = () => `crit_new${++minted}`;

describe("rubric totals", () => {
  it("takes the best level of each criterion as its worth", () => {
    assert.equal(criterionMaxPoints(rubric.criteria[0]!), 4);
    assert.equal(criterionMaxPoints(rubric.criteria[1]!), 6);
    assert.equal(rubricMaxPoints(rubric), 10);
    assert.equal(rubricMaxPoints({ criteria: [] }), 0);
  });

  it("adds fractional points without float noise", () => {
    const fractional = { criteria: [0.1, 0.2, 0.7].map((points, i) => ({ id: `c${i}`, title: "x", levels: [{ label: "a", points: 0 }, { label: "b", points }] })) };
    assert.equal(rubricMaxPoints(fractional), 1);
    assert.equal(formatPoints(2.5), "2.5");
    assert.equal(formatPoints(3), "3");
    assert.equal(formatPoints(1.999999), "2");
    assert.equal(formatPoints(0.25), "0.25");
  });

  it("computes percent and the points needed to pass", () => {
    assert.equal(scorePercent(7, 10), 70);
    assert.equal(scorePercent(1, 3), 33.3);
    assert.equal(scorePercent(5, 0), 0);
    assert.equal(pointsToPass(20, 70), 14);
    assert.equal(pointsToPass(15, 65), 9.75);
  });
});

describe("scoreRubric", () => {
  it("scores a full set of selections from the rubric's own points", () => {
    const result = scoreRubric(rubric, [
      { criterionId: "crit_clarity", levelIndex: 2, comment: "  Easy to follow.  " },
      { criterionId: "crit_depth", levelIndex: 0 },
    ]);
    assert.equal(result.complete, true);
    assert.deepEqual(result.missing, []);
    assert.equal(result.total, 10);
    assert.equal(result.max, 10);
    assert.equal(result.percent, 100);
    assert.equal(result.passed, true);
    assert.deepEqual(result.scores, [
      { criterionId: "crit_clarity", levelIndex: 2, points: 4, comment: "Easy to follow." },
      { criterionId: "crit_depth", levelIndex: 0, points: 6 },
    ]);
  });

  it("fails below the pass mark and passes exactly on it", () => {
    // 2 + 1 = 3 of 10.
    const low = scoreRubric(rubric, [
      { criterionId: "crit_clarity", levelIndex: 1 },
      { criterionId: "crit_depth", levelIndex: 1 },
    ]);
    assert.equal(low.total, 3);
    assert.equal(low.percent, 30);
    assert.equal(low.passed, false);

    // 0 + 6 = 6 of 10 at a 60 % pass mark: exactly on the threshold.
    const edge = scoreRubric({ ...rubric, passPercent: 60 }, [
      { criterionId: "crit_clarity", levelIndex: 0 },
      { criterionId: "crit_depth", levelIndex: 0 },
    ]);
    assert.equal(edge.total, 6);
    assert.equal(edge.passed, true);
    assert.equal(scoreRubric({ ...rubric, passPercent: 61 }, edge.scores).passed, false);
  });

  it("reports unrated criteria and never passes an incomplete rubric", () => {
    const partial = scoreRubric({ ...rubric, passPercent: 10 }, [{ criterionId: "crit_depth", levelIndex: 0 }]);
    assert.equal(partial.complete, false);
    assert.deepEqual(partial.missing, ["crit_clarity"]);
    assert.equal(partial.total, 6);
    assert.equal(partial.passed, false, "60% is above the pass mark, but one criterion is unrated");
  });

  it("ignores unknown criteria, out-of-range levels and client-supplied points", () => {
    const forged = [
      { criterionId: "crit_clarity", levelIndex: 7 },
      { criterionId: "crit_depth", levelIndex: 1, points: 999 },
      { criterionId: "crit_other", levelIndex: 0 },
      { criterionId: "crit_clarity", levelIndex: 1.5 },
    ] as unknown as Parameters<typeof scoreRubric>[1];
    const result = scoreRubric(rubric, forged);
    assert.deepEqual(result.scores, [{ criterionId: "crit_depth", levelIndex: 1, points: 1 }]);
    assert.deepEqual(result.missing, ["crit_clarity"]);
    assert.equal(result.total, 1);
  });

  it("uses the last selection of a criterion and trims long comments", () => {
    const result = scoreRubric(rubric, [
      { criterionId: "crit_clarity", levelIndex: 0 },
      { criterionId: "crit_clarity", levelIndex: 2, comment: "x".repeat(RUBRIC_LIMITS.commentMax + 50) },
      { criterionId: "crit_depth", levelIndex: 0 },
    ]);
    assert.equal(result.scores[0]!.points, 4);
    assert.equal(result.scores[0]!.comment!.length, RUBRIC_LIMITS.commentMax);
  });

  it("treats a rubric without criteria as not gradable", () => {
    const empty = scoreRubric({ criteria: [], passPercent: 0 }, []);
    assert.equal(empty.complete, false);
    assert.equal(empty.passed, false);
  });
});

describe("pass threshold", () => {
  it("has no floating-point drift at the boundary", () => {
    assert.equal(meetsThreshold(7, 10, 70), true);
    assert.equal(meetsThreshold(0.7, 1, 70), true);
    assert.equal(meetsThreshold(2.1, 3, 70), true);
    assert.equal(meetsThreshold(6.99, 10, 70), false);
    assert.equal(meetsThreshold(14, 20, 70), true);
    assert.equal(meetsThreshold(13.99, 20, 70), false);
  });

  it("handles the extremes", () => {
    assert.equal(meetsThreshold(0, 10, 0), true, "a 0% pass mark always passes");
    assert.equal(meetsThreshold(9.99, 10, 100), false);
    assert.equal(meetsThreshold(10, 10, 100), true);
    assert.equal(meetsThreshold(0, 0, 0), false, "a rubric worth nothing cannot be passed");
  });
});

describe("stored scores", () => {
  it("totals stored scores, including criteria removed from the rubric later", () => {
    assert.equal(totalOfScores(undefined), 0);
    assert.equal(
      totalOfScores([
        { criterionId: "crit_clarity", levelIndex: 1, points: 2 },
        { criterionId: "crit_removed", levelIndex: 0, points: 1.5 },
      ]),
      3.5,
    );
  });

  it("averages several scored rubrics per criterion", () => {
    const average = averageScores(rubric, [
      [
        { criterionId: "crit_clarity", levelIndex: 2, points: 4 },
        { criterionId: "crit_depth", levelIndex: 0, points: 6 },
      ],
      [{ criterionId: "crit_clarity", levelIndex: 1, points: 2 }],
      [],
      undefined,
    ]);
    assert.equal(average.count, 2, "empty sets are not counted");
    assert.deepEqual(average.criteria, [
      { criterionId: "crit_clarity", average: 3, count: 2 },
      { criterionId: "crit_depth", average: 6, count: 1 },
    ]);
    assert.equal(average.total, 9);
    assert.equal(average.max, 10);
    assert.equal(average.percent, 90);
  });

  it("picks the level closest to an average, preferring the higher one on a tie", () => {
    const clarity = rubric.criteria[0]!;
    assert.equal(nearestLevelIndex(clarity, 3.4), 2);
    assert.equal(nearestLevelIndex(clarity, 0.4), 0);
    assert.equal(nearestLevelIndex(clarity, 3), 2, "3 is as close to 2 as to 4");
    assert.equal(nearestLevelIndex({ levels: [] }, 3), -1);
  });
});

describe("validateRubricInput", () => {
  const valid = {
    title: "  Essay   rubric ",
    passPercent: "62.54",
    criteria: [
      {
        id: "crit_keep",
        title: " Thesis ",
        description: "Line one\r\nLine two",
        levels: [
          { label: "No", points: "0" },
          { label: "Yes", points: 2.556, description: " Clear thesis " },
        ],
      },
      { id: "BAD ID", title: "Evidence", levels: [{ label: "Low", points: 1 }, { label: "High", points: 3 }] },
      { id: "crit_keep", title: "Style", levels: [{ label: "Low", points: 1 }, { label: "High", points: 2 }] },
    ],
  };

  it("normalizes text, rounds numbers and keeps well-formed unique ids", () => {
    const result = validateRubricInput(valid, makeId);
    assert.ok(result.ok);
    assert.equal(result.value.title, "Essay rubric");
    assert.equal(result.value.passPercent, 62.5);
    const [thesis, evidence, style] = result.value.criteria;
    assert.equal(thesis!.id, "crit_keep");
    assert.equal(thesis!.title, "Thesis");
    assert.equal(thesis!.description, "Line one\nLine two");
    assert.deepEqual(thesis!.levels, [
      { label: "No", points: 0 },
      { label: "Yes", points: 2.56, description: "Clear thesis" },
    ]);
    assert.match(evidence!.id, /^crit_new\d+$/, "a malformed id is replaced");
    assert.match(style!.id, /^crit_new\d+$/, "a duplicate id is replaced");
    assert.notEqual(evidence!.id, style!.id);
  });

  it("requires a title, a pass mark and at least one criterion", () => {
    const result = validateRubricInput({ title: " ", passPercent: "abc", criteria: [] }, makeId);
    assert.ok(!result.ok);
    assert.ok(result.fieldErrors.title);
    assert.ok(result.fieldErrors.passPercent);
    assert.ok(result.fieldErrors.criteria);
    assert.equal(result.error, result.fieldErrors.title);
    assert.ok(!validateRubricInput({ title: "T", passPercent: 101, criteria: valid.criteria }, makeId).ok);
    assert.ok(!validateRubricInput({ title: "T", passPercent: -1, criteria: valid.criteria }, makeId).ok);
    assert.ok(!validateRubricInput({ title: "T", passPercent: 50, criteria: "nope" }, makeId).ok);
  });

  it("points at the exact cell that is wrong", () => {
    const result = validateRubricInput(
      {
        title: "T",
        passPercent: 50,
        criteria: [
          { title: "", levels: [{ label: "", points: -1 }, { label: "Ok", points: RUBRIC_LIMITS.pointsMax + 1 }] },
          { title: "One level", levels: [{ label: "Only", points: 1 }] },
          { title: "Worthless", levels: [{ label: "A", points: 0 }, { label: "B", points: 0 }] },
        ],
      },
      makeId,
    );
    assert.ok(!result.ok);
    assert.ok(result.fieldErrors["criteria.0.title"]);
    assert.ok(result.fieldErrors["criteria.0.levels.0.label"]);
    assert.ok(result.fieldErrors["criteria.0.levels.0.points"]);
    assert.ok(result.fieldErrors["criteria.0.levels.1.points"]);
    assert.ok(result.fieldErrors["criteria.1.levels"]);
    assert.ok(result.fieldErrors["criteria.2.levels"], "a criterion needs at least one level worth points");
  });

  it("enforces the size limits", () => {
    const level = (label: string) => ({ label, points: 1 });
    const tooManyLevels = { title: "Many", levels: Array.from({ length: RUBRIC_LIMITS.levelsMax + 1 }, (_, i) => level(`L${i}`)) };
    const result = validateRubricInput({ title: "x".repeat(RUBRIC_LIMITS.titleMax + 1), passPercent: 50, criteria: [tooManyLevels] }, makeId);
    assert.ok(!result.ok);
    assert.ok(result.fieldErrors.title);
    assert.ok(result.fieldErrors["criteria.0.levels"]);
    const tooManyCriteria = Array.from({ length: RUBRIC_LIMITS.criteriaMax + 1 }, () => ({ title: "C", levels: [level("a"), level("b")] }));
    const big = validateRubricInput({ title: "T", passPercent: 50, criteria: tooManyCriteria }, makeId);
    assert.ok(!big.ok);
    assert.ok(big.fieldErrors.criteria);
  });
});

describe("copies and templates", () => {
  it("clones criteria with fresh ids and no shared references", () => {
    const copy = cloneCriteria(rubric.criteria, makeId);
    assert.equal(copy.length, 2);
    assert.notEqual(copy[0]!.id, rubric.criteria[0]!.id);
    assert.notEqual(copy[0]!.id, copy[1]!.id);
    assert.deepEqual(
      copy.map((c) => c.levels),
      rubric.criteria.map((c) => c.levels),
    );
    copy[0]!.levels[0]!.points = 99;
    assert.equal(rubric.criteria[0]!.levels[0]!.points, 0);
  });

  it("ships templates that pass validation as they are", () => {
    assert.ok(RUBRIC_TEMPLATES.length >= 3);
    for (const template of RUBRIC_TEMPLATES) {
      const result = validateRubricInput({ title: template.title, passPercent: template.passPercent, criteria: template.criteria }, makeId);
      assert.ok(result.ok, `${template.key} is a valid rubric`);
      assert.ok(rubricMaxPoints(result.value) > 0);
    }
    assert.equal(findRubricTemplate("project")?.title, "Project");
    assert.equal(findRubricTemplate("unknown"), null);
    assert.equal(findRubricTemplate(undefined), null);
  });
});
