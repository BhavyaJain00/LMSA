import fs from "node:fs";
import path from "node:path";
import { siteConfig } from "@/lib/config";
import type { RedirectRule } from "./redirects";

/**
 * Small JSON files the SEO layer keeps next to the database (`storage/seo/`):
 *  - `redirects.json`: the slug-redirect rules, read by the proxy on every
 *    request (cached in memory, re-read only when the file's mtime changes),
 *  - `content-index.json`: the last content snapshot used to detect slug
 *    changes and new public pages.
 *
 * No `server-only` import: the proxy (Node.js runtime) reads the redirect file too.
 */

export function seoStorageDir(): string {
  const dataFile = path.resolve(/* turbopackIgnore: true */ process.cwd(), siteConfig.dataFile);
  return path.join(/* turbopackIgnore: true */ path.dirname(dataFile), "seo");
}

export const REDIRECTS_FILE = "redirects.json";
export const CONTENT_INDEX_FILE = "content-index.json";

export function seoFilePath(name: string): string {
  return path.join(/* turbopackIgnore: true */ seoStorageDir(), name);
}

/** Atomic write (temp file + rename) so readers never see a half-written file. */
export async function writeJsonFile(name: string, data: unknown): Promise<void> {
  const file = seoFilePath(name);
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.promises.writeFile(tmp, JSON.stringify(data), "utf8");
  await fs.promises.rename(tmp, file);
}

export async function readJsonFile<T>(name: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.promises.readFile(seoFilePath(name), "utf8")) as T;
  } catch {
    return null;
  }
}

/** Validate the rules read back from disk (the file could be edited by hand). */
export function parseRedirectRules(raw: unknown): RedirectRule[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((r): r is RedirectRule => !!r && typeof r === "object" && typeof (r as RedirectRule).from === "string" && typeof (r as RedirectRule).to === "string")
    .filter((r) => r.from.startsWith("/") && r.to.startsWith("/") && !r.to.startsWith("//"))
    .map((r) => ({ from: r.from, to: r.to }));
}

export async function writeRedirectRules(rules: RedirectRule[]): Promise<void> {
  await writeJsonFile(REDIRECTS_FILE, rules);
}

/** Synchronous read for the proxy (tiny file, cached by mtime by the caller). */
export function readRedirectRulesSync(): { rules: RedirectRule[]; mtimeMs: number } | null {
  const file = seoFilePath(REDIRECTS_FILE);
  try {
    const stat = fs.statSync(file);
    return { rules: parseRedirectRules(JSON.parse(fs.readFileSync(file, "utf8"))), mtimeMs: stat.mtimeMs };
  } catch {
    return null;
  }
}

export function redirectFileMtimeSync(): number {
  try {
    return fs.statSync(seoFilePath(REDIRECTS_FILE)).mtimeMs;
  } catch {
    return 0;
  }
}
