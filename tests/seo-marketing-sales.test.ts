import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db/store";
import { removeSalesPageAction, saveSalesPageAction } from "@/lib/actions/sales-page";
import {
  SALES_LIMITS,
  addableSectionTypes,
  countdownParts,
  emptySalesPage,
  hasSalesPage,
  moveItem,
  normalizeSalesPage,
  parseSalesSeo,
  salesPageTemplate,
  visibleSalesFaq,
} from "@/lib/seo/sales-page";
import { makeCourse, makeUser, resetDb } from "./helpers/db";
import { resetRequest } from "./helpers/request";

describe("normalizeSalesPage", () => {
  it("keeps known sections in order and drops unknown types and fields", () => {
    const { page, errors } = normalizeSalesPage({
      heroHeadline: "  Learn SQL in a weekend  ",
      sections: [
        { id: "a", type: "text", title: "Why", body: "Because.", extra: 1 },
        { id: "b", type: "bogus", title: "Nope" },
        { id: "c", type: "pricing" },
        "not a section",
      ],
      faq: [],
      testimonials: [],
      admin: true,
    });
    assert.deepEqual(errors, {});
    assert.equal(page.heroHeadline, "Learn SQL in a weekend");
    assert.deepEqual(
      page.sections.map((s) => [s.id, s.type]),
      [
        ["a", "text"],
        ["c", "pricing"],
      ],
    );
    assert.equal("extra" in page.sections[0]!, false);
    assert.equal("admin" in page, false);
    assert.equal(page.showStats, true);
  });

  it("allows single-use sections once and repeatable ones many times", () => {
    const { page } = normalizeSalesPage({
      sections: [
        { id: "p1", type: "pricing" },
        { id: "p2", type: "pricing" },
        { id: "t1", type: "text", body: "x" },
        { id: "t2", type: "text", body: "y" },
        { id: "c1", type: "cta" },
        { id: "c2", type: "cta" },
      ],
    });
    assert.deepEqual(
      page.sections.map((s) => s.id),
      ["p1", "t1", "t2", "c1", "c2"],
    );
  });

  it("repairs bad or duplicate section ids", () => {
    const { page } = normalizeSalesPage({ sections: [{ id: "x y <script>", type: "text" }, { id: "dup", type: "cta" }, { id: "dup", type: "cta" }] });
    const ids = page.sections.map((s) => s.id);
    assert.equal(ids[0], "sec_1");
    assert.equal(new Set(ids).size, ids.length);
    for (const id of ids) assert.match(id, /^[A-Za-z0-9_-]+$/);
  });

  it("caps the number of sections and feature items, drops untitled items and unknown icons", () => {
    const sections = Array.from({ length: SALES_LIMITS.sections + 5 }, (_, i) => ({ id: `s${i}`, type: "text", body: "x" }));
    assert.equal(normalizeSalesPage({ sections }).page.sections.length, SALES_LIMITS.sections);

    const items = [{ title: "" }, { title: "Real", icon: "Rocket" }, { title: "Bad icon", icon: "<svg>" }, ...Array.from({ length: 20 }, (_, i) => ({ title: `Item ${i}` }))];
    const { page } = normalizeSalesPage({ sections: [{ id: "f", type: "features", items }] });
    const out = page.sections[0]!.items!;
    assert.equal(out.length, SALES_LIMITS.items);
    assert.deepEqual(out[0], { title: "Real", icon: "Rocket" });
    assert.deepEqual(out[1], { title: "Bad icon" });
  });

  it("validates testimonials: name and quote required, rating clamped, unsafe photo URLs dropped", () => {
    const { page } = normalizeSalesPage({
      testimonials: [
        { name: "Ana", quote: "Great", rating: 9, avatarUrl: "javascript:alert(1)" },
        { name: "", quote: "No name" },
        { name: "Bo", quote: "Fine", rating: 0.2, avatarUrl: "//evil.example/x.png" },
        { name: "Cy", quote: "Good", avatarUrl: "/uploads/cy.png", role: "Analyst" },
      ],
    });
    assert.equal(page.testimonials.length, 3);
    assert.equal(page.testimonials[0]!.rating, 5);
    assert.equal(page.testimonials[0]!.avatarUrl, undefined);
    assert.equal(page.testimonials[1]!.rating, 1);
    assert.equal(page.testimonials[1]!.avatarUrl, undefined);
    assert.equal(page.testimonials[2]!.avatarUrl, "/uploads/cy.png");
    assert.equal(page.testimonials[2]!.role, "Analyst");
  });

  it("requires content for testimonial and FAQ sections and a valid countdown date", () => {
    const { errors, page } = normalizeSalesPage({
      sections: [
        { id: "t", type: "testimonials" },
        { id: "f", type: "faq" },
      ],
      countdownEndsAt: "not a date",
    });
    assert.ok(errors.testimonials);
    assert.ok(errors.faq);
    assert.ok(errors.countdownEndsAt);
    assert.equal(page.countdownEndsAt, undefined);
    assert.equal(normalizeSalesPage({ countdownEndsAt: "2026-12-01T10:00:00+02:00" }).page.countdownEndsAt, "2026-12-01T08:00:00.000Z");
  });
});

describe("sales page helpers", () => {
  it("knows when a page replaces the standard layout", () => {
    assert.equal(hasSalesPage(undefined), false);
    assert.equal(hasSalesPage(emptySalesPage()), false);
    assert.equal(hasSalesPage({ ...emptySalesPage(), heroHeadline: "Hi" }), true);
    assert.equal(hasSalesPage({ ...emptySalesPage(), sections: [{ id: "a", type: "cta" }] }), true);
  });

  it("marks up FAQ only when the FAQ section is shown", () => {
    const faq = [{ question: "Q?", answer: "A." }];
    assert.deepEqual(visibleSalesFaq({ ...emptySalesPage(), heroHeadline: "x", faq }), []);
    assert.deepEqual(visibleSalesFaq({ ...emptySalesPage(), faq, sections: [{ id: "f", type: "faq" }] }), faq);
    assert.deepEqual(visibleSalesFaq(null), []);
  });

  it("builds a complete template from the course", () => {
    const page = salesPageTemplate({ title: "SQL", shortIntroduction: "Query data.", outcomes: ["Write joins", "Group rows"], hasVideo: true, hasCertificate: true });
    const types = page.sections.map((s) => s.type);
    assert.equal(types[0], "video");
    for (const t of ["features", "curriculum", "instructor", "pricing", "faq", "cta"] as const) assert.ok(types.includes(t), t);
    assert.deepEqual(
      page.sections.find((s) => s.id === "sec_outcomes")!.items!.map((i) => i.title),
      ["Write joins", "Group rows"],
    );
    assert.ok(page.sections.some((s) => s.items?.some((i) => i.icon === "Certificate")));
    assert.ok(page.faq.length >= 3);
    // The template passes its own validation.
    assert.deepEqual(normalizeSalesPage(page).errors, {});
    const plain = salesPageTemplate({ title: "SQL", shortIntroduction: "", outcomes: [], hasVideo: false, hasCertificate: false });
    assert.equal(plain.sections.some((s) => s.type === "video"), false);
    assert.ok(plain.sections.find((s) => s.id === "sec_outcomes")!.items!.length > 0);
  });

  it("computes countdown parts and stops at zero", () => {
    const now = Date.parse("2026-01-01T00:00:00Z");
    assert.deepEqual(countdownParts("2026-01-02T01:02:03Z", now), { done: false, days: 1, hours: 1, minutes: 2, seconds: 3 });
    assert.equal(countdownParts("2025-12-31T00:00:00Z", now).done, true);
    assert.equal(countdownParts(undefined, now).done, true);
    assert.equal(countdownParts("garbage", now).done, true);
  });

  it("lists addable sections and moves items", () => {
    const addable = addableSectionTypes([{ type: "pricing" }, { type: "text" }]);
    assert.equal(addable.includes("pricing"), false);
    assert.ok(addable.includes("text"));
    assert.ok(addable.includes("faq"));
    assert.deepEqual(moveItem(["a", "b", "c"], 0, 1), ["b", "a", "c"]);
    assert.deepEqual(moveItem(["a", "b", "c"], 2, -2), ["c", "a", "b"]);
    assert.deepEqual(moveItem(["a", "b"], 0, -1), ["a", "b"]);
  });

  it("validates the SEO fields", () => {
    assert.deepEqual(parseSalesSeo({ seoTitle: "  SQL   course ", metaDescription: "", ogImageUrl: "/uploads/og.png" }).patch, {
      seoTitle: "SQL course",
      metaDescription: undefined,
      ogImageUrl: "/uploads/og.png",
    });
    const bad = parseSalesSeo({ seoTitle: "x".repeat(80), metaDescription: "y".repeat(200), ogImageUrl: "javascript:alert(1)" });
    assert.ok(bad.errors.seoTitle && bad.errors.metaDescription && bad.errors.ogImageUrl);
  });
});

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

async function login(userId: string) {
  resetRequest();
  await createSession(userId);
}

describe("sales page actions", () => {
  beforeEach(async () => {
    await resetDb({
      users: [
        makeUser({ id: "usr_teacher", roles: ["course_creator"] }),
        makeUser({ id: "usr_other", roles: ["course_creator"] }),
        makeUser({ id: "usr_student", roles: ["student"] }),
      ],
      courses: [makeCourse({ id: "crs_sql", slug: "sql", instructorIds: ["usr_teacher"] })],
    });
  });

  const page = { heroHeadline: "Master SQL", sections: [{ id: "a", type: "faq" }], faq: [{ question: "Is it hard?", answer: "No." }], testimonials: [], showStats: false };

  it("saves the page and the SEO fields for the course's instructor", async () => {
    await login("usr_teacher");
    const result = await saveSalesPageAction(null, form({ courseId: "crs_sql", page: JSON.stringify(page), seoTitle: "SQL course", metaDescription: "Learn SQL fast.", ogImageUrl: "" }));
    assert.equal(result.ok, true, JSON.stringify(result));
    const course = (await getDb()).courses.find((c) => c.id === "crs_sql")!;
    assert.equal(course.salesPage?.heroHeadline, "Master SQL");
    assert.equal(course.salesPage?.showStats, false);
    assert.equal(course.seoTitle, "SQL course");
    assert.equal(course.metaDescription, "Learn SQL fast.");
    assert.equal(course.ogImageUrl, undefined);
  });

  it("refuses other instructors, learners and guests", async () => {
    for (const user of ["usr_other", "usr_student", null]) {
      if (user) await login(user);
      else resetRequest();
      const result = await saveSalesPageAction(null, form({ courseId: "crs_sql", page: JSON.stringify(page) }));
      assert.equal(result.ok, false);
    }
    assert.equal((await getDb()).courses[0]!.salesPage, undefined);
  });

  it("rejects unreadable JSON and invalid content with field errors", async () => {
    await login("usr_teacher");
    const broken = await saveSalesPageAction(null, form({ courseId: "crs_sql", page: "{oops" }));
    assert.equal(broken.ok, false);
    const invalid = await saveSalesPageAction(null, form({ courseId: "crs_sql", page: JSON.stringify({ ...page, faq: [] }) }));
    assert.equal(invalid.ok, false);
    if (!invalid.ok) assert.ok(invalid.fieldErrors?.faq);
  });

  it("removes the page but keeps the SEO fields", async () => {
    await login("usr_teacher");
    await saveSalesPageAction(null, form({ courseId: "crs_sql", page: JSON.stringify(page), seoTitle: "Kept" }));
    const result = await removeSalesPageAction("crs_sql");
    assert.equal(result.ok, true);
    const course = (await getDb()).courses[0]!;
    assert.equal(course.salesPage, undefined);
    assert.equal(course.seoTitle, "Kept");
    await login("usr_student");
    assert.equal((await removeSalesPageAction("crs_sql")).ok, false);
  });
});
