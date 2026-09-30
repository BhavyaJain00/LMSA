import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { siteConfig } from "@/lib/config";
import { isS3Configured, maskSecret, storageEnv } from "@/lib/server-env";
import type { Settings } from "@/lib/types";
import { uid } from "@/lib/utils";
import { isSafeStorageKey } from "./keys";
import { LocalStorage } from "./local";
import { S3Storage } from "./remote";
import { S3Client, resolveSigningRegion, usesPathStyle } from "./s3";
import type { StorageDriver } from "./types";

export type { StorageDriver, StorageDriverKind, ReadResult, StoredObjectInfo, ProcessingInput } from "./types";
export { isSafeStorageKey, isSafeStoragePrefix, storageKeyFromUrl, uploadUrlForKey, keyDirectory } from "./keys";

/**
 * Storage driver selection.
 *
 * STORAGE_DRIVER=s3 with a bucket and keys stores uploads in an S3-compatible
 * bucket; otherwise files stay in UPLOAD_DIR. Uploads are always received on
 * local disk first (streamed, resumable) and moved to the driver when they
 * are complete. Files stored locally before switching to S3 keep working:
 * `/uploads/…` looks on disk first, then in the bucket.
 */

interface StorageCache {
  local?: LocalStorage;
  remote?: S3Storage;
  remoteKey?: string;
}

const g = globalThis as unknown as { __llStorage?: StorageCache };
const cache: StorageCache = (g.__llStorage ??= {});

/** Absolute upload folder (UPLOAD_DIR). */
export function uploadRoot(): string {
  return path.resolve(/* turbopackIgnore: true */ process.cwd(), siteConfig.uploadDir);
}

export function localStorage(): LocalStorage {
  const root = uploadRoot();
  if (!cache.local || cache.local.root !== root) cache.local = new LocalStorage(root);
  return cache.local;
}

export function s3Client(): S3Client | null {
  if (!isS3Configured()) return null;
  return remoteStorage()!.client;
}

function remoteStorage(): S3Storage | null {
  if (!isS3Configured()) return null;
  const key = [storageEnv.endpoint, storageEnv.region, storageEnv.bucket, storageEnv.accessKeyId, storageEnv.secretAccessKey, storageEnv.forcePathStyle].join("|");
  if (!cache.remote || cache.remoteKey !== key) {
    cache.remote = new S3Storage(
      new S3Client({
        endpoint: storageEnv.endpoint,
        region: storageEnv.region,
        bucket: storageEnv.bucket,
        accessKeyId: storageEnv.accessKeyId,
        secretAccessKey: storageEnv.secretAccessKey,
        forcePathStyle: storageEnv.forcePathStyle,
      }),
    );
    cache.remoteKey = key;
  }
  return cache.remote;
}

/** The driver new files are stored with. */
export function getStorage(): StorageDriver {
  return remoteStorage() ?? localStorage();
}

/** Remote storage is active (files may live in the bucket instead of on disk). */
export function isRemoteStorage(): boolean {
  return isS3Configured();
}

/** Driver holding `key`: local disk when the file is there (older uploads), else the active driver. */
export async function storageFor(key: string): Promise<StorageDriver> {
  const remote = remoteStorage();
  if (!remote) return localStorage();
  return (await localStorage().head(key)) ? localStorage() : remote;
}

/** Cache policy stored with an object: videos stay private (served through signed routes), other uploads are immutable. */
export function cacheControlForKey(key: string): string {
  return key.toLowerCase().startsWith("videos/") ? "private, max-age=0" : "public, max-age=31536000, immutable";
}

/**
 * Copy a file received on local disk to remote storage, then delete the
 * local copy (reads fall back to the bucket). Returns false when remote
 * storage is off or the file is not on disk. If the local copy cannot be
 * deleted yet (open on Windows), it stays and keeps being served locally.
 */
export async function offloadLocalFile(key: string, contentType: string): Promise<boolean> {
  const remote = remoteStorage();
  if (!remote) return false;
  const local = localStorage();
  const file = local.pathOf(key);
  if (!(await local.head(key))) return false;
  await remote.putFile(key, file, { contentType, cacheControl: cacheControlForKey(key) });
  await fs.rm(file, { force: true }).catch(() => undefined);
  return true;
}

export interface MigrationResult {
  moved: number;
  failed: number;
  bytes: number;
  /** More local files are left (run again). */
  more: boolean;
  errors: string[];
}

/**
 * Move files still kept in the upload folder to remote storage (after
 * switching to S3, or files whose background copy failed). Hidden folders
 * (partial uploads, conversions in progress) are skipped. At most `limit`
 * files per run.
 */
export async function migrateLocalToRemote(limit = 200, contentTypeOf: (key: string) => string = () => "application/octet-stream"): Promise<MigrationResult> {
  const result: MigrationResult = { moved: 0, failed: 0, bytes: 0, more: false, errors: [] };
  if (!remoteStorage()) return result;
  const root = uploadRoot();
  const entries = await fs.readdir(root, { recursive: true, withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const rel = path.relative(root, path.join(/* turbopackIgnore: true */ entry.parentPath, entry.name)).split(path.sep).join("/");
    if (!isSafeStorageKey(rel)) continue; // dot-files and dot-folders (in-progress work) are never moved
    if (result.moved + result.failed >= limit) {
      result.more = true;
      break;
    }
    try {
      const info = await localStorage().head(rel);
      if (await offloadLocalFile(rel, contentTypeOf(rel))) {
        result.moved++;
        result.bytes += info?.size ?? 0;
      }
    } catch (err) {
      result.failed++;
      if (result.errors.length < 5) result.errors.push(`${rel}: ${describeError(err).slice(0, 200)}`);
    }
  }
  return result;
}

/** Number and total size of files kept in the upload folder (hidden work folders excluded). */
export async function localUsage(): Promise<{ files: number; bytes: number }> {
  const root = uploadRoot();
  const entries = await fs.readdir(root, { recursive: true, withFileTypes: true }).catch(() => []);
  let files = 0;
  let bytes = 0;
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const rel = path.relative(root, path.join(/* turbopackIgnore: true */ entry.parentPath, entry.name)).split(path.sep).join("/");
    if (!isSafeStorageKey(rel)) continue;
    const stat = await fs.stat(path.join(/* turbopackIgnore: true */ entry.parentPath, entry.name)).catch(() => null);
    if (!stat) continue;
    files++;
    bytes += stat.size;
  }
  return { files, bytes };
}

/**
 * Public origin for objects that need no signature (images, documents):
 * Settings → Storage CDN base URL, else S3_PUBLIC_BASE_URL. Only used with
 * remote storage — with local storage, put the CDN in front of the site.
 */
export function publicBaseUrl(settings: Pick<Settings, "storage">): string | null {
  if (!isRemoteStorage()) return null;
  const base = (settings.storage.cdnBaseUrl?.trim() || storageEnv.publicBaseUrl).trim().replace(/\/+$/, "");
  return /^https?:\/\//i.test(base) ? base : null;
}

/* ------------------------------------------------------------------ */
/* Admin status                                                         */
/* ------------------------------------------------------------------ */

export interface StorageStatus {
  driver: "local" | "s3";
  /** STORAGE_DRIVER asked for s3, but required values are missing (files stay local). */
  misconfigured: boolean;
  missing: string[];
  localDir: string;
  /** Free/total bytes of the volume holding UPLOAD_DIR (when the OS reports it). */
  disk: { free: number; total: number } | null;
  s3: {
    endpoint: string;
    provider: string;
    /** Region requests are signed for (S3_REGION, or the one inferred from the endpoint). */
    region: string;
    bucket: string;
    accessKeyId: string;
    secretSet: boolean;
    publicBaseUrl: string;
    /** Objects are addressed as `endpoint/bucket/key` (S3_FORCE_PATH_STYLE, or chosen automatically). */
    pathStyle: boolean;
  } | null;
}

function providerOf(endpoint: string): string {
  const host = (() => {
    try {
      return new URL(endpoint).hostname.toLowerCase();
    } catch {
      return "";
    }
  })();
  if (!endpoint) return "Amazon S3";
  if (host.endsWith(".r2.cloudflarestorage.com")) return "Cloudflare R2";
  if (host.endsWith(".backblazeb2.com")) return "Backblaze B2";
  if (host.endsWith(".digitaloceanspaces.com")) return "DigitalOcean Spaces";
  if (host.endsWith(".wasabisys.com")) return "Wasabi";
  if (host.endsWith(".amazonaws.com")) return "Amazon S3";
  if (host === "localhost" || host === "127.0.0.1" || /^minio/.test(host)) return "MinIO";
  return "S3-compatible";
}

export async function getStorageStatus(): Promise<StorageStatus> {
  const wantsS3 = storageEnv.driver === "s3";
  const missing: string[] = [];
  if (wantsS3) {
    if (!storageEnv.bucket) missing.push("S3_BUCKET");
    if (!storageEnv.accessKeyId) missing.push("S3_ACCESS_KEY_ID");
    if (!storageEnv.secretAccessKey) missing.push("S3_SECRET_ACCESS_KEY");
  }
  let disk: StorageStatus["disk"] = null;
  try {
    await fs.mkdir(uploadRoot(), { recursive: true });
    const s = await fs.statfs(uploadRoot());
    disk = { free: s.bavail * s.bsize, total: s.blocks * s.bsize };
  } catch {
    disk = null;
  }
  return {
    driver: isS3Configured() ? "s3" : "local",
    misconfigured: wantsS3 && missing.length > 0,
    missing,
    localDir: uploadRoot(),
    disk,
    s3: wantsS3
      ? {
          endpoint: storageEnv.endpoint,
          provider: providerOf(storageEnv.endpoint),
          region: resolveSigningRegion(storageEnv.endpoint, storageEnv.region),
          bucket: storageEnv.bucket,
          accessKeyId: maskSecret(storageEnv.accessKeyId),
          secretSet: !!storageEnv.secretAccessKey,
          publicBaseUrl: storageEnv.publicBaseUrl,
          pathStyle: usesPathStyle(storageEnv),
        }
      : null,
  };
}

export interface ConnectionStep {
  step: "write" | "read" | "signed-url" | "delete";
  ok: boolean;
  ms: number;
  error?: string;
}

function describeError(err: unknown): string {
  if (err instanceof Error) {
    const cause = (err as Error & { cause?: { code?: string; message?: string } }).cause;
    const detail = cause?.code || cause?.message;
    return detail && !err.message.includes(detail) ? `${err.message} (${detail})` : err.message;
  }
  return String(err);
}

/**
 * Write, read back, fetch through a presigned URL (remote only) and delete a
 * small probe object with the active driver.
 */
export async function testStorageConnection(): Promise<{ driver: "local" | "s3"; steps: ConnectionStep[] }> {
  const driver = getStorage();
  const key = `connection-test/${uid("probe")}.txt`;
  const payload = `LearnLoop storage check ${new Date().toISOString()}`;
  const steps: ConnectionStep[] = [];
  const time = async (step: ConnectionStep["step"], fn: () => Promise<void>): Promise<boolean> => {
    const started = performance.now();
    try {
      await fn();
      steps.push({ step, ok: true, ms: Math.round(performance.now() - started) });
      return true;
    } catch (err) {
      steps.push({ step, ok: false, ms: Math.round(performance.now() - started), error: describeError(err).slice(0, 300) });
      return false;
    }
  };

  const wrote = await time("write", () => driver.putBytes(key, Buffer.from(payload, "utf8"), { contentType: "text/plain; charset=utf-8" }));
  if (wrote) {
    await time("read", async () => {
      const text = await driver.readText(key, 4096);
      if (text !== payload) throw new Error("The file read back does not match what was written.");
    });
    const client = s3Client();
    if (client && driver.kind === "s3") {
      await time("signed-url", async () => {
        const res = await fetch(client.presignGet(key, 60), { cache: "no-store", signal: AbortSignal.timeout(15_000) });
        const text = await res.text();
        if (!res.ok) throw new Error(`Presigned download failed with HTTP ${res.status}.`);
        if (text !== payload) throw new Error("The presigned download returned different content.");
      });
    }
    await time("delete", () => driver.delete(key));
  }
  return { driver: driver.kind, steps };
}
