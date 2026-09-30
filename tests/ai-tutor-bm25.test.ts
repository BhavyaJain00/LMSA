import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildBm25Index, searchBm25, type Bm25Doc } from "@/lib/ai/bm25";

let order = 0;
function doc(id: string, lessonId: string, title: string, text: string, extra: Partial<Bm25Doc> = {}): Bm25Doc {
  return { id, lessonId, title, text, order: order++, ...extra };
}

const filler = "This passage talks about general programming practice, naming, formatting and reading documentation carefully.";

const corpus: Bm25Doc[] = [
  doc("a1", "L1", "Variables", `Variables store values. Use let for values that change and const for values that do not. ${filler}`),
  doc("a2", "L1", "Variables › Scope", `Block scope limits where a variable is visible. ${filler}`),
  doc("b1", "L2", "Closures", `A closure is a function that remembers the variables of the scope where it was created. Closures enable private state. ${filler}`),
  doc("b2", "L2", "Closures › Pitfalls", `A common closure pitfall is capturing a loop variable declared with var. ${filler}`),
  doc("c1", "L3", "Promises", `A promise represents a value that arrives later. Chain then calls or use async and await. ${filler}`),
  doc("c2", "L3", "Promises › Errors", `Handle promise rejections with catch or try/catch around await. ${filler}`),
  doc("d1", "L4", "Recursion", `Recursion is when a function calls itself. Every recursive function needs a base case. ${filler}`),
];

describe("ai tutor BM25 ranking", () => {
  const index = buildBm25Index(corpus);

  it("ranks the passage that is about the query first", () => {
    const hits = searchBm25(index, "What is a closure?");
    assert.ok(hits.length > 0);
    assert.equal(hits[0]!.doc.lessonId, "L2");
    assert.ok(hits.every((h, i) => i === 0 || hits[i - 1]!.score >= h.score), "results must be sorted by score");
  });

  it("weights rare terms above common ones (idf)", () => {
    const hits = searchBm25(index, "base case programming");
    assert.equal(hits[0]!.doc.id, "d1", "the rare term 'base case' should beat the ubiquitous 'programming'");
  });

  it("returns nothing for an empty or stopword-only query", () => {
    assert.deepEqual(searchBm25(index, ""), []);
    assert.deepEqual(searchBm25(index, "what is the"), []);
    assert.deepEqual(searchBm25(buildBm25Index([]), "closure"), []);
  });

  it("boosts query terms that appear in the title", () => {
    const docs = [
      doc("t1", "X", "Unrelated heading", "The event loop runs callbacks. The event loop never blocks while waiting."),
      doc("t2", "Y", "Event loop", "Callbacks run when the stack is empty and the event queue has work."),
    ];
    const idx = buildBm25Index(docs);
    const withBoost = searchBm25(idx, "event loop");
    assert.equal(withBoost[0]!.doc.id, "t2");
    const noBoost = searchBm25(idx, "event loop", { weights: { titleBoost: 0 } });
    assert.equal(noBoost[0]!.doc.id, "t1", "without the title boost the body-heavy passage wins");
  });

  it("boosts the lesson the learner is on", () => {
    const docs = [
      doc("x1", "LA", "Arrays", "Arrays keep items in order and map transforms each item."),
      doc("x2", "LB", "Arrays again", "Arrays keep items in order and map transforms each item."),
    ];
    const idx = buildBm25Index(docs);
    assert.equal(searchBm25(idx, "map items", { currentLessonId: "LB", weights: { titleBoost: 0 } })[0]!.doc.id, "x2");
    assert.equal(searchBm25(idx, "map items", { currentLessonId: "LA", weights: { titleBoost: 0 } })[0]!.doc.id, "x1");
  });

  it("prefers trusted instructor clarifications on close calls", () => {
    const docs = [
      doc("n1", "L", "Hoisting", "Hoisting moves declarations to the top of their scope."),
      doc("n2", "L", "Hoisting", "Hoisting moves declarations to the top of their scope.", { trusted: true }),
    ];
    const hits = searchBm25(buildBm25Index(docs), "hoisting declarations");
    assert.equal(hits[0]!.doc.id, "n2");
    assert.ok(hits[0]!.score > hits[1]!.score);
  });

  it("caps results per lesson and honours k", () => {
    const docs = Array.from({ length: 8 }, (_, i) => doc(`m${i}`, "BIG", `Generators ${i}`, `Generators yield values lazily, part ${i}.`));
    docs.push(doc("o1", "OTHER", "Iterators", "Generators are built on the iterator protocol."));
    const idx = buildBm25Index(docs);
    const hits = searchBm25(idx, "generators yield", { k: 10, maxPerLesson: 3 });
    assert.equal(hits.filter((h) => h.doc.lessonId === "BIG").length, 3);
    assert.ok(hits.some((h) => h.doc.lessonId === "OTHER"));
    assert.equal(searchBm25(idx, "generators", { k: 2 }).length, 2);
  });

  it("only searches allowed lessons but keeps course-level passages", () => {
    const docs = [...corpus, doc("ov", "", "Course overview", "This course covers closures, promises and recursion.")];
    const idx = buildBm25Index(docs);
    const hits = searchBm25(idx, "closures promises", { allowedLessonIds: new Set(["L3"]) });
    assert.ok(hits.length > 0);
    assert.ok(hits.every((h) => h.doc.lessonId === "L3" || h.doc.lessonId === ""), "locked lessons leaked");
    assert.ok(hits.some((h) => h.doc.id === "ov"));
  });

  it("tops up with the current lesson for 'this lesson' questions and when nothing matches", () => {
    const summary = searchBm25(index, "Summarize this lesson for me", { currentLessonId: "L3", fillFromCurrentLesson: true });
    assert.deepEqual(
      summary.map((h) => h.doc.id),
      ["c1", "c2"],
    );
    assert.ok(summary.every((h) => h.score === 0));

    const foreign = searchBm25(index, "¿Qué significa esto?", { currentLessonId: "L4", fillFromCurrentLesson: true });
    assert.deepEqual(
      foreign.map((h) => h.doc.id),
      ["d1"],
    );

    // A specific question that matches elsewhere is not padded.
    const specific = searchBm25(index, "closure pitfall", { currentLessonId: "L4", fillFromCurrentLesson: true });
    assert.ok(!specific.some((h) => h.doc.id === "d1"));

    // Never tops up from a lesson the viewer may not read.
    const locked = searchBm25(index, "recap this video", { currentLessonId: "L4", fillFromCurrentLesson: true, allowedLessonIds: new Set(["L1"]) });
    assert.ok(!locked.some((h) => h.doc.lessonId === "L4"));

    // Without the option nothing is added.
    assert.deepEqual(searchBm25(index, "¿Qué significa esto?", { currentLessonId: "L4" }), []);
  });

  it("breaks score ties by outline order", () => {
    const docs = [doc("z2", "L", "Same", "identical words here", { order: 2 }), doc("z1", "L", "Same", "identical words here", { order: 1 })];
    const hits = searchBm25(buildBm25Index(docs), "identical words");
    assert.deepEqual(
      hits.map((h) => h.doc.id),
      ["z1", "z2"],
    );
  });
});
