import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = process.cwd();
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...tsxFiles(path));
    else if (entry.name.endsWith(".tsx")) out.push(path);
  }
  return out;
}

/**
 * The media player renders inside `dir="ltr"` (a timeline runs left to right in every language),
 * so its arrows must not flip.
 */
const LTR_ISLANDS = [`src${sep}components${sep}player${sep}`];

describe("i18n RTL: the Arabic shell mirrors direction", () => {
  it("every left/right chevron and arrow icon flips in RTL", () => {
    const offenders: string[] = [];
    for (const file of tsxFiles("src")) {
      if (LTR_ISLANDS.some((prefix) => file.startsWith(prefix))) continue;
      const source = read(file);
      // The whole JSX tag, even when its props span several lines.
      for (const match of source.matchAll(/<Icon\.(ChevronLeft|ChevronRight|ArrowLeft|ArrowRight)\b[\s\S]*?\/>/g)) {
        if (!/\brtl:/.test(match[0])) {
          const line = source.slice(0, match.index).split("\n").length;
          offenders.push(`${relative(ROOT, join(ROOT, file))}:${line}`);
        }
      }
    }
    assert.deepEqual(offenders, []);
  });

  it("side panels are pinned to the inline end, not the physical right", () => {
    const frame = read("src/components/learn/lesson-frame.tsx");
    assert.match(frame, /lg:end-0/);
    assert.match(frame, /lg:border-s\b/);
    assert.doesNotMatch(frame, /lg:right-0|lg:border-l\b/);
    const drawer = read("src/components/legal/audit-detail-drawer.tsx");
    assert.match(drawer, /\bend-0\b/);
    assert.doesNotMatch(drawer, /\bright-0\b|\bborder-l\b/);
  });
});

describe("i18n fonts: Arabic and Devanagari have a matching face", () => {
  it("the root layout self-hosts Noto Sans Arabic and Noto Sans Devanagari", () => {
    const layout = read("src/app/layout.tsx");
    assert.match(layout, /Noto_Sans_Arabic\(\{[^}]*subsets: \["arabic"\]/);
    assert.match(layout, /Noto_Sans_Devanagari\(\{[^}]*subsets: \["devanagari"\]/);
    assert.match(layout, /notoArabic\.variable/);
    assert.match(layout, /notoDevanagari\.variable/);
  });

  it("the font stack puts the script face first only for ar and hi", () => {
    const css = read("src/app/globals.css");
    assert.match(css, /--font-sans: var\(--font-script, var\(--font-geist-sans\)\)/);
    assert.match(css, /html:lang\(ar\)\s*\{\s*--font-script: var\(--font-noto-arabic\)/);
    assert.match(css, /html:lang\(hi\)\s*\{\s*--font-script: var\(--font-noto-devanagari\)/);
  });
});
