import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  addDays,
  clamp,
  cn,
  fd,
  fdBool,
  fdNumber,
  formatBytes,
  formatClock,
  formatDuration,
  formatPrice,
  formatTime,
  groupBy,
  initials,
  isValidEmail,
  isValidUrl,
  parseTime,
  percent,
  readingTimeSeconds,
  relativeTime,
  seededShuffle,
  shortCode,
  slugify,
  splitLines,
  splitList,
  stripMarkdown,
  toDateKey,
  truncate,
  uid,
  unique,
  uniqueSlug,
} from "@/lib/utils";

/** Intl uses narrow/no-break spaces in some formats; compare with plain spaces. */
const plain = (s: string) => s.replace(/[  ]/g, " ");

describe("formatTime", () => {
  it("formats minutes and seconds", () => {
    assert.equal(formatTime(0), "0:00");
    assert.equal(formatTime(5), "0:05");
    assert.equal(formatTime(125), "2:05");
    assert.equal(formatTime(59.9), "0:59");
  });

  it("adds hours with zero-padded minutes", () => {
    assert.equal(formatTime(3600), "1:00:00");
    assert.equal(formatTime(3725), "1:02:05");
    assert.equal(formatTime(36125), "10:02:05");
  });

  it("treats negative and non-finite input as zero", () => {
    assert.equal(formatTime(-5), "0:00");
    assert.equal(formatTime(Number.NaN), "0:00");
    assert.equal(formatTime(Number.POSITIVE_INFINITY), "0:00");
  });
});

describe("parseTime", () => {
  it("parses h:mm:ss, m:ss and plain seconds", () => {
    assert.equal(parseTime("1:02:05"), 3725);
    assert.equal(parseTime("2:05"), 125);
    assert.equal(parseTime("125"), 125);
    assert.equal(parseTime("  2:05  "), 125);
    assert.equal(parseTime("0:07.5"), 7.5);
  });

  it("round-trips with formatTime", () => {
    for (const seconds of [0, 9, 60, 61, 599, 3599, 3600, 3725, 86399]) {
      assert.equal(parseTime(formatTime(seconds)), seconds);
    }
  });

  it("returns NaN for malformed input", () => {
    for (const input of ["", "   ", "abc", "1:-2", "-5", "1::2", ":30", "1:", "0x10", "1e3", "1:2:3:4", "Infinity"]) {
      assert.ok(Number.isNaN(parseTime(input)), `expected NaN for ${JSON.stringify(input)}`);
    }
  });
});

describe("formatDuration", () => {
  it("uses the largest sensible units", () => {
    assert.equal(formatDuration(3725), "1h 2m");
    assert.equal(formatDuration(3600), "1h");
    assert.equal(formatDuration(125), "2m");
    assert.equal(formatDuration(30), "30s");
    assert.equal(formatDuration(0), "0s");
  });

  it("rounds to whole seconds and clamps negatives", () => {
    assert.equal(formatDuration(59.6), "1m");
    assert.equal(formatDuration(-10), "0s");
  });
});

describe("formatPrice", () => {
  it("shows the free label for zero", () => {
    assert.equal(formatPrice(0), "Free");
    assert.equal(formatPrice(0, "EUR", "Included"), "Included");
  });

  it("formats amounts stored in the smallest unit", () => {
    assert.equal(formatPrice(1999), "$19.99");
    assert.equal(formatPrice(123456, "USD"), "$1,234.56");
    assert.equal(formatPrice(1999, "EUR"), "€19.99");
    assert.equal(formatPrice(150000, "JPY"), "¥1,500");
    assert.equal(plain(formatPrice(2500, "INR")), "₹25.00");
  });

  it("falls back to a plain label for currencies Intl rejects", () => {
    assert.equal(formatPrice(1999, "US"), "US 19.99");
  });
});

describe("slugify", () => {
  it("lowercases and joins words with hyphens", () => {
    assert.equal(slugify("Hello, World!"), "hello-world");
    assert.equal(slugify("  --Intro to   Python 3--  "), "intro-to-python-3");
  });

  it("strips accents", () => {
    assert.equal(slugify("Crème Brûlée"), "creme-brulee");
    assert.equal(slugify("ÀÉÎõü"), "aeiou");
  });

  it("falls back to 'item' when nothing is left", () => {
    assert.equal(slugify(""), "item");
    assert.equal(slugify("!!!"), "item");
    assert.equal(slugify("日本語"), "item");
  });

  it("limits the length to 80 characters without a trailing hyphen", () => {
    const long = slugify("word ".repeat(40));
    assert.ok(long.length <= 80);
    assert.ok(!long.endsWith("-"), long);
    const cut = slugify(`${"a".repeat(79)} b`);
    assert.equal(cut, "a".repeat(79));
  });
});

describe("uniqueSlug", () => {
  it("keeps a free slug", () => {
    assert.equal(uniqueSlug("Intro", []), "intro");
  });

  it("suffixes -2, -3 … until the slug is free", () => {
    assert.equal(uniqueSlug("Intro", ["intro"]), "intro-2");
    assert.equal(uniqueSlug("Intro", new Set(["intro", "intro-2", "intro-3"])), "intro-4");
    assert.equal(uniqueSlug("Intro", ["intro-2"]), "intro");
  });

  it("accepts any iterable", () => {
    function* taken() {
      yield "a-b";
      yield "a-b-2";
    }
    assert.equal(uniqueSlug("A b", taken()), "a-b-3");
  });
});

describe("seededShuffle", () => {
  const items = Array.from({ length: 20 }, (_, i) => i);

  it("is deterministic for a seed", () => {
    assert.deepEqual(seededShuffle(items, "attempt-1"), seededShuffle(items, "attempt-1"));
  });

  it("returns a permutation and leaves the input untouched", () => {
    const copy = [...items];
    const shuffled = seededShuffle(items, "seed");
    assert.deepEqual(items, copy);
    assert.deepEqual([...shuffled].sort((a, b) => a - b), items);
  });

  it("gives different orders for different seeds", () => {
    const orders = new Set(["a", "b", "c", "d", "e"].map((seed) => seededShuffle(items, seed).join(",")));
    assert.ok(orders.size >= 4, `only ${orders.size} distinct orders`);
    assert.notDeepEqual(seededShuffle(items, "a"), items);
  });

  it("handles empty and single-item lists", () => {
    assert.deepEqual(seededShuffle([], "x"), []);
    assert.deepEqual(seededShuffle(["only"], "x"), ["only"]);
  });
});

describe("percent", () => {
  it("rounds to a whole percentage", () => {
    assert.equal(percent(1, 3), 33);
    assert.equal(percent(2, 3), 67);
    assert.equal(percent(3, 3), 100);
    assert.equal(percent(0, 7), 0);
  });

  it("is 0 when there is nothing to complete", () => {
    assert.equal(percent(0, 0), 0);
    assert.equal(percent(5, 0), 0);
    assert.equal(percent(1, -2), 0);
  });
});

describe("relativeTime", () => {
  const now = new Date("2026-03-10T12:00:00Z");
  const ago = (seconds: number) => new Date(now.getTime() - seconds * 1000).toISOString();

  it("says 'just now' for the last few seconds", () => {
    assert.equal(relativeTime(ago(0), now), "just now");
    assert.equal(relativeTime(ago(9), now), "just now");
  });

  it("uses seconds, minutes, hours and days", () => {
    assert.equal(relativeTime(ago(30), now), "30 seconds ago");
    assert.equal(relativeTime(ago(90), now), "2 minutes ago");
    assert.equal(relativeTime(ago(2 * 3600), now), "2 hours ago");
    assert.equal(relativeTime(ago(86400), now), "yesterday");
    assert.equal(relativeTime(ago(3 * 86400), now), "3 days ago");
    assert.equal(relativeTime(ago(7 * 86400), now), "last week");
    assert.equal(relativeTime(ago(400 * 86400), now), "last year");
  });

  it("describes future instants", () => {
    assert.equal(relativeTime(ago(-86400), now), "tomorrow");
    assert.equal(relativeTime(ago(-300), now), "in 5 minutes");
  });

  it("returns an empty string for invalid dates", () => {
    assert.equal(relativeTime("not a date", now), "");
  });
});

describe("toDateKey and addDays", () => {
  it("formats the local calendar date", () => {
    assert.equal(toDateKey(new Date(2026, 0, 5, 23, 59)), "2026-01-05");
    assert.equal(toDateKey(new Date(2026, 11, 31, 0, 0)), "2026-12-31");
    assert.equal(toDateKey(new Date(2024, 1, 29, 12)), "2024-02-29");
  });

  it("defaults to today", () => {
    const now = new Date();
    assert.equal(toDateKey(), toDateKey(now));
  });

  it("adds calendar days without mutating the input", () => {
    const start = new Date(2026, 1, 27, 10);
    const later = addDays(start, 3);
    assert.equal(toDateKey(later), "2026-03-02");
    assert.equal(toDateKey(start), "2026-02-27");
    assert.equal(toDateKey(addDays(start, -58)), "2025-12-31");
    assert.equal(later.getHours(), 10);
  });
});

describe("small helpers", () => {
  it("cn joins truthy class names", () => {
    assert.equal(cn("a", false, null, undefined, "", "b", 0, "c"), "a b c");
  });

  it("uid has the prefix and 16 url-safe characters", () => {
    assert.match(uid("usr"), /^usr_[a-z0-9]{16}$/);
    assert.match(uid(), /^[a-z0-9]{16}$/);
    assert.notEqual(uid(), uid());
  });

  it("shortCode uses unambiguous characters", () => {
    assert.match(shortCode(), /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    assert.match(shortCode(3, 2), /^[A-HJ-NP-Z2-9]{2}(-[A-HJ-NP-Z2-9]{2}){2}$/);
  });

  it("formatBytes picks a unit", () => {
    assert.equal(formatBytes(0), "0 B");
    assert.equal(formatBytes(512), "512 B");
    assert.equal(formatBytes(1536), "1.5 KB");
    assert.equal(formatBytes(5 * 1024 * 1024), "5.0 MB");
  });

  it("formatClock converts 24h to 12h time", () => {
    assert.equal(formatClock("00:05"), "12:05 AM");
    assert.equal(formatClock("12:00"), "12:00 PM");
    assert.equal(formatClock("14:30"), "2:30 PM");
    assert.equal(formatClock("bad"), "bad");
    assert.equal(formatClock(undefined), "");
  });

  it("clamp, initials, truncate", () => {
    assert.equal(clamp(5, 0, 3), 3);
    assert.equal(clamp(-1, 0, 3), 0);
    assert.equal(initials("ada   lovelace byron"), "AL");
    assert.equal(initials("   "), "?");
    assert.equal(truncate("short", 10), "short");
    assert.equal(truncate("a long sentence here", 8), "a long…");
  });

  it("isValidEmail / isValidUrl", () => {
    assert.ok(isValidEmail("ada@example.com"));
    assert.ok(!isValidEmail("ada@example"));
    assert.ok(!isValidEmail("ada example@x.com"));
    assert.ok(isValidUrl("/courses/intro"));
    assert.ok(isValidUrl("https://example.com/x"));
    assert.ok(!isValidUrl("javascript:alert(1)"));
    assert.ok(!isValidUrl("ftp://example.com"));
    assert.ok(!isValidUrl("not a url"));
  });

  it("stripMarkdown and readingTimeSeconds", () => {
    const md = "# Title\n\nSome **bold** and _em_ text with a [link](https://x.y) and `code`.\n\n```js\nignored()\n```\n- item";
    assert.equal(stripMarkdown(md), "Title\nSome bold and em text with a link and code.\nitem");
    assert.equal(readingTimeSeconds("word ".repeat(200)), 60);
    assert.equal(readingTimeSeconds(""), 0);
  });

  it("list helpers", () => {
    assert.deepEqual(splitList("a, b\n c,,\n"), ["a", "b", "c"]);
    assert.deepEqual(splitLines("a, b\n\n c "), ["a, b", "c"]);
    assert.deepEqual(unique([1, 2, 1, 3, 2]), [1, 2, 3]);
    assert.deepEqual(groupBy(["apple", "avocado", "banana"], (s) => s[0]!), { a: ["apple", "avocado"], b: ["banana"] });
  });

  it("form data readers", () => {
    const form = new FormData();
    form.set("name", "  Ada  ");
    form.set("on", "on");
    form.set("yes", "true");
    form.set("n", " 42 ");
    form.set("bad", "abc");
    assert.equal(fd(form, "name"), "Ada");
    assert.equal(fd(form, "missing"), "");
    assert.equal(fdBool(form, "on"), true);
    assert.equal(fdBool(form, "yes"), true);
    assert.equal(fdBool(form, "name"), false);
    assert.equal(fdNumber(form, "n"), 42);
    assert.equal(fdNumber(form, "bad", 7), 7);
  });
});
