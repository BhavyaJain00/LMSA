import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { LegalPage } from "@/lib/types";
import { createSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db/store";
import {
  applyLegalPageChange,
  fillLegalPlaceholders,
  isTemplateContent,
  isValidLegalSlug,
  LEGAL_CONTENT_MAX,
  removeTemplateNotice,
  sortLegalPages,
  validateLegalPageInput,
  validateNewLegalSlug,
} from "@/lib/legal/pages-shared";
import { getLegalPage, mergeWithStarterPages } from "@/lib/legal/pages";
import { legalLinks } from "@/lib/legal/links";
import { agreementDocuments, listSeparator } from "@/lib/legal/agreement";
import { deleteLegalPageAction, restoreLegalTemplateAction, saveLegalPageAction } from "@/lib/legal/actions";
import { makeUser, resetDb } from "./helpers/db";
import { captureRedirect, resetRequest } from "./helpers/request";

/** Round 3 legal-ops part 1: legal pages (rules, versions, links, agreement sentence, editor actions). */

const NOW = new Date("2026-09-01T12:00:00.000Z");
const LATER = new Date("2026-09-02T08:30:00.000Z");
const NOTICE = "Template — review with a lawyer before publishing.";

function legalPage(overrides: Partial<LegalPage> = {}): LegalPage {
  return {
    id: `legal_${overrides.slug ?? "privacy"}`,
    slug: "privacy",
    title: "Privacy Policy",
    content: "# Privacy\n\nWe keep your data safe.",
    updatedAt: NOW.toISOString(),
    version: 1,
    published: true,
    ...overrides,
  };
}

describe("legal page rules", () => {
  it("accepts lower-case hyphenated slugs only", () => {
    for (const ok of ["privacy", "acceptable-use", "imprint2", "a"]) assert.equal(isValidLegalSlug(ok), true, ok);
    for (const bad of ["", "Privacy", "-lead", "trail-", "double--dash", "with space", "../etc", "x".repeat(61)]) assert.equal(isValidLegalSlug(bad), false, bad);
  });

  it("detects and strips the starter-template notice", () => {
    const content = `# Privacy Policy\n\n> ${NOTICE}\n\nReal text.`;
    assert.equal(isTemplateContent(content), true);
    assert.equal(isTemplateContent("Template - review with a lawyer"), true, "plain hyphen");
    assert.equal(isTemplateContent("Our template was reviewed."), false);
    const cleaned = removeTemplateNotice(content);
    assert.equal(isTemplateContent(cleaned), false);
    assert.match(cleaned, /Real text\./);
    assert.match(cleaned, /^# Privacy Policy/);
  });

  it("fills placeholders case-insensitively and keeps unknown tokens visible", () => {
    const text = fillLegalPlaceholders("{{companyName}} · {{ SITENAME }} · {{contactEmail}} · {{companyAddress}} · {{lastUpdated}} · {{typo}}", {
      companyName: "Acme Ltd",
      siteName: "Acme Learn",
      siteUrl: "https://acme.test",
      contactEmail: " privacy@acme.test ",
      updatedAt: "2026-03-05T23:59:00.000Z",
    });
    assert.equal(text, "Acme Ltd · Acme Learn · privacy@acme.test ·  · March 5, 2026 · {{typo}}");
  });

  it("sorts core pages first in their fixed order, then custom pages by title", () => {
    const sorted = sortLegalPages([
      { slug: "zeta", title: "Zeta" },
      { slug: "cookies", title: "Cookie Policy" },
      { slug: "alpha", title: "Alpha" },
      { slug: "privacy", title: "Privacy Policy" },
      { slug: "terms", title: "Terms of Service" },
    ]);
    assert.deepEqual(
      sorted.map((p) => p.slug),
      ["privacy", "terms", "cookies", "alpha", "zeta"],
    );
  });

  it("validates titles and text, and refuses to publish the template notice", () => {
    assert.deepEqual(validateLegalPageInput({ title: "Terms", content: "Text" }, "publish"), {});
    assert.ok(validateLegalPageInput({ title: "  ", content: "Text" }, "save").title);
    assert.ok(validateLegalPageInput({ title: "x".repeat(121), content: "" }, "save").title);
    assert.deepEqual(validateLegalPageInput({ title: "Terms", content: "" }, "save"), {}, "an empty draft may be saved");
    assert.ok(validateLegalPageInput({ title: "Terms", content: "   " }, "publish").content);
    assert.ok(validateLegalPageInput({ title: "Terms", content: `${NOTICE}\n\nText` }, "publish").content);
    assert.deepEqual(validateLegalPageInput({ title: "Terms", content: `${NOTICE}\n\nText` }, "save"), {}, "drafts may keep the notice");
    assert.ok(validateLegalPageInput({ title: "Terms", content: "x".repeat(LEGAL_CONTENT_MAX + 1) }, "save").content);
  });

  it("validates the address of a new custom page", () => {
    assert.equal(validateNewLegalSlug("imprint", ["privacy", "terms"]), null);
    assert.match(validateNewLegalSlug("Imprint", []) ?? "", /lower-case/);
    assert.match(validateNewLegalSlug("cookies", []) ?? "", /standard legal pages/);
    assert.match(validateNewLegalSlug("imprint", ["imprint"]) ?? "", /already uses/);
  });
});

describe("legal page versions", () => {
  it("saves a draft without touching the version", () => {
    const draft = legalPage({ published: false, version: 0 });
    const change = applyLegalPageChange(draft, { title: "Privacy Policy", content: "New text" }, "save", LATER);
    assert.equal(change.publishedVersion, false);
    assert.equal(change.page.version, 0);
    assert.equal(change.page.published, false);
    assert.equal(change.page.content, "New text");
    assert.equal(change.page.updatedAt, LATER.toISOString());
  });

  it("increments the version and moves 'Last updated' on every published change", () => {
    const first = applyLegalPageChange(legalPage({ published: false, version: 0 }), { title: "Privacy Policy", content: "v1" }, "publish", NOW);
    assert.equal(first.publishedVersion, true);
    assert.equal(first.page.version, 1);
    assert.equal(first.page.published, true);
    const second = applyLegalPageChange(first.page, { title: "Privacy Policy", content: "v2" }, "save", LATER);
    assert.equal(second.publishedVersion, true, "saving a published page publishes it (no hidden drafts)");
    assert.equal(second.page.version, 2);
    assert.equal(second.page.updatedAt, LATER.toISOString());
  });

  it("does nothing when a published page is unchanged", () => {
    const page = legalPage();
    const change = applyLegalPageChange(page, { title: "Privacy Policy ", content: page.content }, "publish", LATER);
    assert.equal(change.unchanged, true);
    assert.equal(change.page, page);
  });

  it("normalizes line endings so pasted Windows text is not a change", () => {
    const page = legalPage({ content: "a\nb" });
    assert.equal(applyLegalPageChange(page, { title: page.title, content: "a\r\nb" }, "publish", LATER).unchanged, true);
  });

  it("unpublishing keeps the version and the date of the text that was live", () => {
    const page = legalPage({ version: 4 });
    const change = applyLegalPageChange(page, { title: page.title, content: page.content }, "unpublish", LATER);
    assert.equal(change.page.published, false);
    assert.equal(change.page.version, 4);
    assert.equal(change.page.updatedAt, NOW.toISOString());
    assert.equal(change.unchanged, false);
    assert.equal(applyLegalPageChange(change.page, { title: page.title, content: page.content }, "unpublish", LATER).unchanged, true);
  });
});

describe("legal page storage and links", () => {
  beforeEach(async () => {
    await resetDb();
    resetRequest();
  });

  it("offers an unpublished starter template for every missing core page", () => {
    const pages = mergeWithStarterPages([legalPage({ slug: "custom-terms", title: "Custom" })], NOW);
    assert.deepEqual(
      pages.map((p) => p.slug),
      ["privacy", "terms", "refunds", "cookies", "custom-terms"],
    );
    for (const p of pages.slice(0, 4)) {
      assert.equal(p.published, false, p.slug);
      assert.equal(p.version, 0, p.slug);
      assert.equal(isTemplateContent(p.content), true, `${p.slug} carries the lawyer notice`);
    }
  });

  it("returns stored pages, starter templates for missing core pages and null for unknown slugs", async () => {
    await resetDb({ legalPages: [legalPage({ slug: "terms", title: "Our terms", content: "Stored" })] });
    assert.equal((await getLegalPage("terms"))?.content, "Stored");
    assert.equal((await getLegalPage("refunds"))?.published, false);
    assert.equal(await getLegalPage("imprint"), null);
  });

  it("links only published pages, core pages first, with short labels", async () => {
    await resetDb({
      legalPages: [
        legalPage({ slug: "imprint", title: "Imprint" }),
        legalPage({ slug: "cookies", title: "Cookie Policy", published: false }),
        legalPage({ slug: "terms", title: "Terms of Service" }),
        legalPage({ slug: "privacy", title: "Privacy Policy" }),
      ],
    });
    const links = await legalLinks();
    assert.deepEqual(
      links.map((l) => [l.slug, l.label, l.href]),
      [
        ["privacy", "Privacy", "/legal/privacy"],
        ["terms", "Terms", "/legal/terms"],
        ["imprint", "Imprint", "/legal/imprint"],
      ],
    );
  });
});

describe("agreement sentence", () => {
  const published = [
    { slug: "privacy", title: "Privacy Policy", href: "/legal/privacy" },
    { slug: "refunds", title: "Refund Policy", href: "/legal/refunds" },
    { slug: "terms", title: "  ", href: "/legal/terms" },
    { slug: "imprint", title: "Imprint", href: "/legal/imprint" },
  ];

  it("names the published documents for each context in reading order", () => {
    assert.deepEqual(
      agreementDocuments("register", published).map((d) => [d.slug, d.title]),
      [
        ["terms", "Terms of Service"],
        ["privacy", "Privacy Policy"],
      ],
    );
    assert.deepEqual(
      agreementDocuments("checkout", published).map((d) => d.slug),
      ["terms", "refunds", "privacy"],
    );
  });

  it("leaves unpublished documents out", () => {
    assert.deepEqual(agreementDocuments("register", []), []);
    assert.deepEqual(
      agreementDocuments("checkout", published.filter((p) => p.slug === "refunds")).map((d) => d.slug),
      ["refunds"],
    );
  });

  it("joins names as an English list", () => {
    const join = (items: string[]) => items.map((item, i) => listSeparator(i, items.length) + item).join("");
    assert.equal(join(["A"]), "A");
    assert.equal(join(["A", "B"]), "A and B");
    assert.equal(join(["A", "B", "C"]), "A, B, and C");
  });
});

describe("legal page editor actions", () => {
  const admin = makeUser({ id: "usr_legal_admin", roles: ["admin"] });
  const student = makeUser({ id: "usr_legal_student" });

  function form(values: Record<string, string>): FormData {
    const data = new FormData();
    for (const [key, value] of Object.entries(values)) data.set(key, value);
    return data;
  }

  beforeEach(async () => {
    await resetDb({ users: [admin, student] });
    resetRequest();
  });

  it("is admin-only", async () => {
    await createSession(student.id);
    const res = await saveLegalPageAction(null, form({ slug: "terms", intent: "publish", title: "Terms", content: "Text" }));
    assert.equal(res.ok, false);
    assert.equal((await getDb()).legalPages.length, 0);
  });

  it("creates a core page from its template on first save, publishes version 1 and audits it", async () => {
    await createSession(admin.id);
    const blocked = await saveLegalPageAction(null, form({ slug: "terms", intent: "publish", title: "Terms of Service", content: `${NOTICE}\n\nOur terms.` }));
    assert.equal(blocked.ok, false, "the template notice blocks publishing");

    const res = await saveLegalPageAction(null, form({ slug: "terms", intent: "publish", title: "Terms of Service", content: "Our terms." }));
    assert.ok(res.ok, res.ok ? "" : res.error);
    assert.equal(res.data.version, 1);
    assert.equal(res.data.published, true);
    const db = await getDb();
    assert.equal(db.legalPages.filter((p) => p.slug === "terms").length, 1);
    assert.ok(db.auditEvents.some((e) => e.action === "legal.publish" && e.meta?.slug === "terms" && e.meta?.version === 1 && e.actorId === admin.id));

    const again = await saveLegalPageAction(null, form({ slug: "terms", intent: "save", title: "Terms of Service", content: "Our updated terms." }));
    assert.ok(again.ok);
    assert.equal(again.data.version, 2);
  });

  it("refuses unknown custom slugs and deleting core pages", async () => {
    await createSession(admin.id);
    const res = await saveLegalPageAction(null, form({ slug: "imprint", intent: "save", title: "Imprint", content: "x" }));
    assert.equal(res.ok, false);
    const del = await deleteLegalPageAction("privacy");
    assert.equal(del.ok, false);
  });

  it("deletes custom pages and restores core templates as unpublished", async () => {
    await resetDb({ users: [admin, student], legalPages: [legalPage({ slug: "imprint", title: "Imprint" }), legalPage({ slug: "privacy", version: 3 })] });
    resetRequest();
    await createSession(admin.id);
    assert.equal(await captureRedirect(() => deleteLegalPageAction("imprint")), "/admin/settings/legal");
    assert.equal((await getDb()).legalPages.some((p) => p.slug === "imprint"), false);

    const restored = await restoreLegalTemplateAction("privacy");
    assert.ok(restored.ok);
    assert.equal(restored.data.published, false);
    assert.equal(restored.data.version, 3, "the version history is kept");
    assert.equal(isTemplateContent(restored.data.content), true);
  });
});
