import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { locateUpload } from "@/lib/media/files";
import { canonicalMediaPath, parseUploadRequestPath } from "@/lib/media/paths";
import { getStorage, isRemoteStorage, storageKeyFromUrl, uploadRoot } from "@/lib/storage";
import { MAX_AVATAR_BYTES, avatarDataUri } from "./profile-card";
import { siteOrigin } from "./site";

/**
 * Avatar pictures for generated share cards, embedded as `data:` URIs.
 *
 * The card renderer would otherwise download `src` URLs itself, so a
 * member-chosen address could make the server fetch anything. Here only
 * files this site stores are read, straight from storage (never over HTTP):
 *  - uploads (`/uploads/<key>`, relative or on this site's origin), from
 *    local disk or the object-storage bucket. Anything in the protected
 *    video folder is skipped, decided from the file's real location on disk.
 *  - static files under `public/` (e.g. demo avatars).
 * Every file must be a PNG or JPEG (checked from its bytes) of at most 2 MB.
 * Any other address, or any failure, returns null and the card shows initials.
 */

const PUBLIC_DIR = "public";

async function readCapped(stream: ReadableStream<Uint8Array>, max: number): Promise<Uint8Array | null> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > max) {
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}

async function readUpload(key: string): Promise<Uint8Array | null> {
  const request = parseUploadRequestPath(key.split("/"));
  if (!request || request.inVideoDir) return null;

  const local = await locateUpload(uploadRoot(), request);
  if (local) {
    if (local.inVideoDir || local.stat.size > MAX_AVATAR_BYTES) return null;
    return fs.readFile(local.filePath);
  }
  if (!isRemoteStorage()) return null;
  const storage = getStorage();
  const info = await storage.head(key);
  if (!info || info.size > MAX_AVATAR_BYTES) return null;
  const result = await storage.read(key);
  if (!result || result === "unsatisfiable") return null;
  return readCapped(result.body, MAX_AVATAR_BYTES);
}

async function readPublicFile(pathname: string): Promise<Uint8Array | null> {
  const clean = canonicalMediaPath(pathname);
  if (!clean || clean === "/") return null;
  const root = path.resolve(/* turbopackIgnore: true */ process.cwd(), PUBLIC_DIR);
  const lexical = path.join(/* turbopackIgnore: true */ root, ...clean.slice(1).split("/"));
  if (!lexical.startsWith(root + path.sep)) return null;
  const [realRoot, real] = await Promise.all([fs.realpath(root), fs.realpath(lexical)]);
  const rel = path.relative(realRoot, real);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  const stat = await fs.stat(real);
  if (!stat.isFile() || stat.size > MAX_AVATAR_BYTES) return null;
  return fs.readFile(real);
}

/** The avatar at `url` as a `data:` URI, or null (show initials instead). */
export async function loadAvatarDataUri(url: string | undefined | null): Promise<string | null> {
  const value = url?.trim();
  if (!value) return null;
  try {
    const key = storageKeyFromUrl(value, [siteOrigin()]);
    if (key) {
      const bytes = await readUpload(key);
      return bytes ? avatarDataUri(bytes) : null;
    }
    if (value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/uploads/")) {
      const pathname = value.split(/[?#]/, 1)[0]!;
      const bytes = await readPublicFile(pathname);
      return bytes ? avatarDataUri(bytes) : null;
    }
    return null;
  } catch {
    return null;
  }
}
