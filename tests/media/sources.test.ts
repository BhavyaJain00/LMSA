import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_SOURCE_LABEL,
  MAX_VIDEO_SOURCES,
  buildQualityOptions,
  heightFromLabel,
  labelForHeight,
  pickAutoQuality,
  sanitizeVideoSources,
} from "@/lib/media/sources";
import { signedUrlTtlSeconds, watermarkFor } from "@/lib/media/sign";
import { buildSettings } from "../helpers/db";

function sanitize(raw: unknown, mainSrc?: string, badUrls: string[] = []) {
  const errors: string[] = [];
  const result = sanitizeVideoSources(raw, {
    checkUrl: (url) => (badUrls.includes(url) || url.includes("youtube.com") ? `Not allowed: ${url}` : null),
    onError: (message) => errors.push(message),
    mainSrc,
  });
  return { result, errors };
}

describe("heightFromLabel / labelForHeight", () => {
  it("reads heights from common labels", () => {
    const cases: [string, number | null][] = [
      ["1080p", 1080],
      [" 720P ", 720],
      ["480 p", 480],
      ["4K", 2160],
      ["UHD", 2160],
      ["8k", 4320],
      ["Full HD", 1080],
      ["FHD", 1080],
      ["HD", 720],
      ["SD", 480],
      ["Data saver", null],
      ["100p", null],
      ["9999p", null],
      ["", null],
    ];
    for (const [label, height] of cases) assert.equal(heightFromLabel(label), height, label);
    assert.equal(labelForHeight(1079.6), "1080p");
  });
});

describe("sanitizeVideoSources", () => {
  it("returns undefined without errors when there is nothing to add", () => {
    assert.deepEqual(sanitize(undefined), { result: undefined, errors: [] });
    assert.deepEqual(sanitize(null), { result: undefined, errors: [] });
    assert.deepEqual(sanitize([]), { result: undefined, errors: [] });
    assert.deepEqual(sanitize([{ src: "  ", label: " " }]), { result: undefined, errors: [] });
  });

  it("reports malformed input", () => {
    assert.deepEqual(sanitize("nope").errors, ["Video qualities are malformed."]);
  });

  it("normalises rows and derives heights", () => {
    const { result, errors } = sanitize([
      { src: " /uploads/videos/a-720.mp4 ", label: "  720p   HD " },
      { src: "/uploads/videos/a-480.mp4", label: "Data saver", height: "480" },
      { src: "/uploads/videos/a-360.mp4", label: "Small", height: 359.6 },
      { src: "/uploads/videos/a-x.mp4", label: "Mystery" },
    ]);
    assert.deepEqual(errors, []);
    assert.deepEqual(result, [
      { src: "/uploads/videos/a-720.mp4", label: "720p HD", height: 720 },
      { src: "/uploads/videos/a-480.mp4", label: "Data saver", height: 480 },
      { src: "/uploads/videos/a-360.mp4", label: "Small", height: 360 },
      { src: "/uploads/videos/a-x.mp4", label: "Mystery" },
    ]);
  });

  it("reports and drops invalid rows", () => {
    const { result, errors } = sanitize(
      [
        { src: "", label: "720p" },
        { src: "https://www.youtube.com/watch?v=x", label: "1080p" },
        { src: "/uploads/videos/no-label.mp4", label: "" },
        { src: "/uploads/videos/huge.mp4", label: "Huge", height: 10000 },
        { src: "/uploads/videos/a.mp4", label: "480p" },
        { src: "/uploads/videos/b.mp4", label: "480P" },
      ],
      "/uploads/videos/main.mp4",
    );
    assert.deepEqual(result, [{ src: "/uploads/videos/a.mp4", label: "480p", height: 480 }]);
    assert.equal(errors.length, 5);
    assert.deepEqual(sanitize(["not an object", 42, null, { src: "/uploads/videos/c.mp4", label: "SD" }]), {
      result: [{ src: "/uploads/videos/c.mp4", label: "SD", height: 480 }],
      errors: [],
    });
    assert.ok(errors[0]!.includes('"720p"'));
    assert.ok(errors[1]!.startsWith("Not allowed"));
    assert.ok(errors[2]!.includes("needs a label"));
    assert.ok(errors[3]!.includes("between 120 and 4320"));
    assert.ok(errors[4]!.includes("both labelled"));
  });

  it("silently drops duplicates of the main source or of another row", () => {
    const { result, errors } = sanitize(
      [
        { src: "/uploads/videos/main.mp4", label: "Original copy" },
        { src: "/uploads/videos/a.mp4", label: "720p" },
        { src: "/uploads/videos/a.mp4", label: "Again" },
      ],
      " /uploads/videos/main.mp4 ",
    );
    assert.deepEqual(errors, []);
    assert.deepEqual(result, [{ src: "/uploads/videos/a.mp4", label: "720p", height: 720 }]);
  });

  it("limits the number of rows and the label length", () => {
    const rows = Array.from({ length: MAX_VIDEO_SOURCES + 2 }, (_, i) => ({ src: `/uploads/videos/q${i}.mp4`, label: `Quality ${i} ${"x".repeat(40)}` }));
    const { result, errors } = sanitize(rows);
    assert.equal(result?.length, MAX_VIDEO_SOURCES);
    assert.ok(result!.every((r) => r.label.length <= MAX_SOURCE_LABEL));
    assert.equal(errors.length, 1);
  });
});

describe("quality options", () => {
  const sources = [
    { src: "/v-480.mp4", label: "480p", height: 480 },
    { src: "/v-1080.mp4", label: "1080p", height: 1080 },
    { src: "/v-saver.mp4", label: "Data saver" },
    { src: "/v.mp4", label: "Duplicate of main" },
  ];

  it("lists the original first when its height is unknown, then highest first", () => {
    const options = buildQualityOptions("/v.mp4", sources);
    assert.deepEqual(
      options.map((o) => [o.id, o.label, o.height]),
      [
        ["main", "Original", undefined],
        ["src:1", "1080p", 1080],
        ["src:0", "480p", 480],
        ["src:2", "Data saver", undefined],
      ],
    );
    assert.deepEqual(buildQualityOptions("/v.mp4", undefined).map((o) => o.id), ["main"]);
  });

  it("sorts the original among renditions when its label has a height", () => {
    assert.deepEqual(
      buildQualityOptions("/v.mp4", sources, "720p").map((o) => o.label),
      ["1080p", "720p", "480p", "Data saver"],
    );
  });

  it("picks an automatic rendition for the connection and player size", () => {
    const options = buildQualityOptions("/v.mp4", sources, "720p");
    const pick = (env: Parameters<typeof pickAutoQuality>[1]) => pickAutoQuality(options, env).label;
    assert.equal(pick({ width: 1920, saveData: true }), "480p");
    assert.equal(pick({ width: 1920, effectiveType: "2g" }), "480p");
    assert.equal(pick({ width: 1920, effectiveType: "3g" }), "480p");
    assert.equal(pick({ width: 640 }), "480p");
    assert.equal(pick({ width: 1280 }), "720p");
    assert.equal(pick({ width: 1280, devicePixelRatio: 2 }), "1080p");
    assert.equal(pick({ width: 4000 }), "1080p");
    const unsized = buildQualityOptions("/v.mp4", [{ src: "/v-480.mp4", label: "480p", height: 480 }]);
    assert.equal(pickAutoQuality(unsized, { width: 4000 }).id, "main");
    assert.equal(pickAutoQuality(buildQualityOptions("/v.mp4", []), { width: 100 }).id, "main");
  });
});

describe("player settings", () => {
  it("clamps the signed URL lifetime to 5–240 minutes", () => {
    const at = (minutes: number) => signedUrlTtlSeconds(buildSettings({ video: { signedUrlMinutes: minutes } }));
    assert.equal(at(60), 3600);
    assert.equal(at(1), 300);
    assert.equal(at(1000), 240 * 60);
    assert.equal(at(Number.NaN), 3600);
  });

  it("watermarks with the viewer's email when enabled", () => {
    const on = buildSettings({ video: { watermark: true, watermarkOpacity: 0.9 } });
    assert.deepEqual(watermarkFor({ email: "ada@example.com", name: "Ada" }, on), { text: "ada@example.com", opacity: 0.5 });
    assert.equal(watermarkFor(null, on), null);
    assert.equal(watermarkFor({ email: "ada@example.com", name: "Ada" }, buildSettings()), null);
  });
});
