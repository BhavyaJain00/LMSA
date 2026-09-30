import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_PER_PAGE, MAX_PER_PAGE, latest, linkHeader, listPage, normalizeListQuery, paginate } from "@/lib/api/pagination";

const rows = Array.from({ length: 7 }, (_, i) => ({
  id: `row_${i}`,
  createdAt: `2026-01-0${i + 1}T00:00:00.000Z`,
  updatedAt: `2026-02-0${7 - i}T00:00:00.000Z`,
}));
const stamps = (r: (typeof rows)[number]) => ({ createdAt: r.createdAt, updatedAt: r.updatedAt });

describe("paginate", () => {
  it("cuts pages and reports totals", () => {
    const page = paginate(rows, 2, 3);
    assert.deepEqual(
      page.items.map((r) => r.id),
      ["row_3", "row_4", "row_5"],
    );
    assert.deepEqual(page.meta, { page: 2, perPage: 3, total: 7, totalPages: 3, hasMore: true });
    const last = paginate(rows, 3, 3);
    assert.equal(last.items.length, 1);
    assert.equal(last.meta.hasMore, false);
  });

  it("returns an empty page past the end", () => {
    const page = paginate(rows, 9, 3);
    assert.deepEqual(page.items, []);
    assert.equal(page.meta.total, 7);
    assert.equal(page.meta.hasMore, false);
  });

  it("clamps sizes and defaults", () => {
    assert.equal(paginate(rows).meta.perPage, DEFAULT_PER_PAGE);
    assert.equal(paginate(rows, 1, 5000).meta.perPage, MAX_PER_PAGE);
    assert.equal(paginate(rows, 0, 0).meta.page, 1);
    assert.equal(paginate([], 1, 10).meta.totalPages, 1);
  });
});

describe("listPage", () => {
  it("sorts newest first by default with a stable id tie-break", () => {
    const tied = [
      { id: "b", createdAt: "2026-01-01T00:00:00Z", updatedAt: "" },
      { id: "a", createdAt: "2026-01-01T00:00:00Z", updatedAt: "" },
      { id: "c", createdAt: "2026-01-02T00:00:00Z", updatedAt: "" },
    ];
    const page = listPage(tied, (r) => r, {});
    assert.deepEqual(
      page.items.map((r) => r.id),
      ["c", "b", "a"],
    );
    assert.deepEqual(
      listPage(tied, (r) => r, { sort: "created_at" }).items.map((r) => r.id),
      ["a", "b", "c"],
    );
  });

  it("sorts by update time", () => {
    const page = listPage(rows, stamps, { sort: "updated_at", perPage: 2 });
    assert.deepEqual(
      page.items.map((r) => r.id),
      ["row_6", "row_5"],
    );
  });

  it("filters with updated_since (inclusive, using the later of created and updated)", () => {
    const page = listPage(rows, stamps, { updated_since: "2026-02-05", sort: "updated_at" });
    assert.deepEqual(
      page.items.map((r) => r.id),
      ["row_2", "row_1", "row_0"],
    );
    const none = listPage(rows, stamps, { updated_since: "2030-01-01T00:00:00Z" });
    assert.equal(none.meta.total, 0);
  });
});

describe("linkHeader", () => {
  it("links first, prev, next and last pages", () => {
    const url = new URL("https://lms.test/api/v1/courses?q=js&per_page=2&page=2");
    const header = linkHeader(url, { page: 2, perPage: 2, total: 7, totalPages: 4, hasMore: true })!;
    assert.match(header, /<https:\/\/lms\.test\/api\/v1\/courses\?q=js&page=1&perPage=2>; rel="first"/);
    assert.match(header, /page=1&perPage=2>; rel="prev"/);
    assert.match(header, /page=3&perPage=2>; rel="next"/);
    assert.match(header, /page=4&perPage=2>; rel="last"/);
    assert.ok(!header.includes("per_page"));
  });

  it("is omitted when everything fits on one page", () => {
    assert.equal(linkHeader(new URL("https://lms.test/api/v1/users"), { page: 1, perPage: 25, total: 3, totalPages: 1, hasMore: false }), null);
  });
});

describe("helpers", () => {
  it("maps per_page to perPage", () => {
    assert.deepEqual(normalizeListQuery({ per_page: "10", q: "x" }), { q: "x", perPage: "10" });
    assert.deepEqual(normalizeListQuery({ per_page: "10", perPage: "5" }), { per_page: "10", perPage: "5" });
  });

  it("picks the latest valid timestamp", () => {
    assert.equal(latest("2026-01-01T00:00:00Z", undefined, "2026-03-01T00:00:00Z", "garbage", null), "2026-03-01T00:00:00Z");
    assert.equal(latest(), "");
  });
});
