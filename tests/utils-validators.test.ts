import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isValidEmail,
  isValidUrl,
  isValidSlug,
  isStrongPassword,
  sanitizeInput,
} from "@/lib/utils/validators";

describe("utils/validators", () => {
  it("isValidEmail validates common and invalid email formats", () => {
    assert.equal(isValidEmail("user@example.com"), true);
    assert.equal(isValidEmail("user.name+tag@sub.domain.org"), true);
    assert.equal(isValidEmail("invalid-email"), false);
    assert.equal(isValidEmail("@missing-user.com"), false);
    assert.equal(isValidEmail("spaces in@email.com"), false);
  });

  it("isValidUrl validates standard http/https urls", () => {
    assert.equal(isValidUrl("https://learnloop.test"), true);
    assert.equal(isValidUrl("http://localhost:3000/courses"), true);
    assert.equal(isValidUrl("ftp://invalid-scheme.com"), false);
    assert.equal(isValidUrl("not a url"), false);
  });

  it("isValidSlug validates url slug strings", () => {
    assert.equal(isValidSlug("intro-to-typescript"), true);
    assert.equal(isValidSlug("module-1"), true);
    assert.equal(isValidSlug("Invalid_Slug"), false);
    assert.equal(isValidSlug("slug with spaces"), false);
    assert.equal(isValidSlug("-leading-hyphen"), false);
  });

  it("isStrongPassword checks requirements correctly", () => {
    const weak = isStrongPassword("short");
    assert.equal(weak.valid, false);
    assert.ok(weak.errors.length > 0);

    const strong = isStrongPassword("SecurePassw0rd!");
    assert.equal(strong.valid, true);
    assert.equal(strong.errors.length, 0);
  });

  it("sanitizeInput removes html tags and control characters", () => {
    assert.equal(sanitizeInput("<script>alert(1)</script>hello"), "alert(1)hello");
    assert.equal(sanitizeInput("  clean text   "), "clean text");
    assert.equal(sanitizeInput("<b>bold</b> & <i>italic</i>"), "bold & italic");
  });
});
