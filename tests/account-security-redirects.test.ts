import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { safeRedirectPath } from "@/lib/auth/redirects";

/**
 * `next` / return paths are honoured only when they stay on this site, the
 * way a browser (WHATWG URL parser) would resolve them.
 */

/** Where a browser would actually go for a Location header / router.push of `path`. */
function browserTarget(path: string): string {
  return new URL(path, "https://lms.example/login").origin;
}

describe("safeRedirectPath", () => {
  it("keeps ordinary same-site paths with their query and hash", () => {
    assert.equal(safeRedirectPath("/dashboard"), "/dashboard");
    assert.equal(safeRedirectPath("/courses/intro/learn/1-2?tab=notes#top"), "/courses/intro/learn/1-2?tab=notes#top");
    assert.equal(safeRedirectPath("/admin?tab=x&y=1"), "/admin?tab=x&y=1");
    assert.equal(safeRedirectPath("/"), "/");
    assert.equal(safeRedirectPath("/a/../b"), "/b");
  });

  it("rejects absolute, protocol-relative and scheme URLs", () => {
    for (const bad of ["https://evil.example", "//evil.example", "///evil.example", "javascript:alert(1)", "JavaScript:alert(1)", "data:text/html,x", "evil.example", "dashboard", ""]) {
      assert.equal(safeRedirectPath(bad), null, JSON.stringify(bad));
    }
  });

  it("rejects backslash tricks (browsers treat \\ as /)", () => {
    for (const bad of ["/\\evil.example", "/\\/evil.example", "\\\\evil.example", "/foo\\bar", decodeURIComponent("/%5Cevil.example"), decodeURIComponent("/%5C%5Cevil.example")]) {
      assert.equal(safeRedirectPath(bad), null, JSON.stringify(bad));
    }
  });

  it("rejects control characters (browsers strip tab/CR/LF anywhere)", () => {
    for (const encoded of ["/%09/evil.example", "/%0a/evil.example", "/%0d/evil.example", "/%00/evil.example", "/%7f", "%09//evil.example", "/%0A%0D/evil.example", "/ok%09"]) {
      const decoded = decodeURIComponent(encoded);
      assert.equal(safeRedirectPath(decoded), null, encoded);
      // The raw strings would indeed leave the site if they got through (sanity check of the premise).
    }
    assert.equal(browserTarget("/\t/evil.example"), "https://evil.example");
    assert.equal(browserTarget("/\\evil.example"), "https://evil.example");
  });

  it("rejects paths that only become protocol-relative after normalisation", () => {
    for (const bad of ["/..//evil.example", "/.//evil.example", "/%2e%2e//evil.example", "/a/../..//evil.example"]) {
      assert.equal(safeRedirectPath(bad), null, bad);
    }
  });

  it("keeps percent-encoded separators as harmless path characters", () => {
    // Double-encoded input arrives as literal %2F / %5C: the browser keeps them inside the path.
    for (const encoded of ["/%2F%2Fevil.example", "/%5Cevil.example"]) {
      const safe = safeRedirectPath(encoded);
      assert.ok(safe !== null, encoded);
      assert.equal(browserTarget(safe), "https://lms.example", encoded);
    }
  });

  it("never returns anything that leaves the site", () => {
    const samples = [
      "/x",
      "/\t/evil.example",
      "/ /evil.example",
      "/%20/evil.example",
      "/　/evil.example",
      "/／/evil.example",
      "/@evil.example",
      "/:@evil.example",
      "/..;/evil.example",
      "/?next=//evil.example",
      "/#//evil.example",
    ];
    for (const sample of samples) {
      const safe = safeRedirectPath(sample);
      if (safe !== null) assert.equal(browserTarget(safe), "https://lms.example", JSON.stringify(sample));
    }
  });

  it("uses the fallback for non-strings and oversized values", () => {
    assert.equal(safeRedirectPath(undefined, "/"), "/");
    assert.equal(safeRedirectPath(["/a", "/b"], "/home"), "/home");
    assert.equal(safeRedirectPath(42, undefined), undefined);
    assert.equal(safeRedirectPath(`/${"a".repeat(3000)}`, "/"), "/");
    assert.equal(safeRedirectPath("//evil.example", "/"), "/");
  });
});
