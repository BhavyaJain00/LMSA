import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { batchTrail, certificateTrail, courseTrail, jobTrail, legalTrail, normalizeTrail, programTrail } from "@/lib/seo/breadcrumbs";

/** Breadcrumb trails shared by the visible <Breadcrumbs> navigation and its BreadcrumbList markup. */

describe("breadcrumb trails", () => {
  it("course: Home → Courses → Category → Course", () => {
    assert.deepEqual(courseTrail({ title: "JS" }, { name: "Web development", slug: "web-development" }), [
      { name: "Home", path: "/" },
      { name: "Courses", path: "/courses" },
      { name: "Web development", path: "/courses/category/web-development" },
      { name: "JS" },
    ]);
    assert.equal(courseTrail({ title: "JS" }, null).length, 3);
  });

  it("other content types end on the current page without a link", () => {
    for (const trail of [batchTrail({ title: "B" }), programTrail({ title: "P" }), jobTrail({ title: "J" }), legalTrail({ title: "L" }), certificateTrail("Sam · JS")]) {
      assert.equal(trail[0]!.path, "/");
      assert.equal(trail.at(-1)!.path, undefined);
    }
    assert.equal(certificateTrail("x")[1]!.path, "/certificates");
  });

  it("normalizeTrail drops nameless items and unlinks the current page", () => {
    assert.deepEqual(normalizeTrail([{ name: "Home", path: "/" }, { name: " " }, { name: "Here", path: "/here" }]), [{ name: "Home", path: "/" }, { name: "Here" }]);
    assert.deepEqual(normalizeTrail([]), []);
  });
});
