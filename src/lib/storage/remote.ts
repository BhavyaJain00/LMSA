import "server-only";
import fs from "node:fs/promises";
import { MAX_DELETE_BATCH, S3Client, S3Error, type S3PartResult } from "./s3";
import { assertSafeKey, isSafeStoragePrefix } from "./keys";
import type { PutOptions, ProcessingInput, ReadResult, StorageDriver, StoredObjectInfo } from "./types";

/**
 * S3-compatible driver. Files up to MULTIPART_THRESHOLD go up in one PUT;
 * larger ones as a multipart upload read from disk one part at a time (a few
 * parts in flight), so a 5 GB video never sits in memory. A failed multipart
 * upload stops its other parts at once and is aborted, so the bucket is not
 * billed for orphaned parts.
 */

export const MULTIPART_THRESHOLD = 16 * 1024 * 1024;
const MIN_PART_SIZE = 16 * 1024 * 1024;
/** S3 allows 10,000 parts; stay well below. */
const MAX_PARTS = 9_000;
const PART_CONCURRENCY = 3;
const DELETE_CONCURRENCY = 8;

/** Part size for a file: at least 16 MiB, large enough to stay under the part limit, whole MiB. */
export function multipartPartSize(size: number): number {
  const mib = 1024 * 1024;
  return Math.max(MIN_PART_SIZE, Math.ceil(size / MAX_PARTS / mib) * mib);
}

async function runPool<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  let failed: unknown = null;
  const lanes = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length && !failed) {
      const item = items[next++]!;
      try {
        await worker(item);
      } catch (err) {
        failed ??= err;
      }
    }
  });
  await Promise.all(lanes);
  if (failed) throw failed;
}

export class S3Storage implements StorageDriver {
  readonly kind = "s3" as const;
  readonly client: S3Client;

  constructor(client: S3Client) {
    this.client = client;
  }

  async putFile(key: string, filePath: string, opts: PutOptions): Promise<void> {
    assertSafeKey(key);
    const { size } = await fs.stat(filePath);
    if (size <= MULTIPART_THRESHOLD) {
      const bytes = await fs.readFile(filePath);
      await this.client.putObject(key, bytes, { contentType: opts.contentType, cacheControl: opts.cacheControl, signal: opts.signal });
      opts.onProgress?.(size);
    } else {
      await this.putMultipart(key, filePath, size, opts);
    }
    if (opts.move) await fs.rm(filePath, { force: true });
  }

  private async putMultipart(key: string, filePath: string, size: number, opts: PutOptions): Promise<void> {
    const partSize = multipartPartSize(size);
    const count = Math.ceil(size / partSize);
    const uploadId = await this.client.createMultipartUpload(key, { contentType: opts.contentType, cacheControl: opts.cacheControl });
    const handle = await fs.open(filePath, "r");
    const parts: S3PartResult[] = [];
    // The first failing part cancels the ones still in flight.
    const cancel = new AbortController();
    const signal = opts.signal ? AbortSignal.any([opts.signal, cancel.signal]) : cancel.signal;
    let stored = 0;
    try {
      await runPool(
        Array.from({ length: count }, (_, i) => i + 1),
        PART_CONCURRENCY,
        async (partNumber) => {
          try {
            signal.throwIfAborted();
            const start = (partNumber - 1) * partSize;
            const length = Math.min(partSize, size - start);
            const buffer = Buffer.allocUnsafe(length);
            let read = 0;
            while (read < length) {
              const { bytesRead } = await handle.read(buffer, read, length - read, start + read);
              if (bytesRead === 0) throw new Error("The file changed while it was being uploaded.");
              read += bytesRead;
            }
            parts.push(await this.client.uploadPart(key, uploadId, partNumber, buffer, signal));
            stored += length;
            opts.onProgress?.(stored);
          } catch (err) {
            cancel.abort(err);
            throw err;
          }
        },
      );
      try {
        await this.client.completeMultipartUpload(key, uploadId, parts);
      } catch (err) {
        // When the answer to a completed upload is lost, the retry finds no such upload: the object is there.
        const completed = err instanceof S3Error && err.code === "NoSuchUpload" && (await this.client.headObject(key).catch(() => null))?.size === size;
        if (!completed) throw err;
      }
    } catch (err) {
      await this.client.abortMultipartUpload(key, uploadId).catch(() => undefined);
      throw err;
    } finally {
      await handle.close();
    }
  }

  async putBytes(key: string, bytes: Uint8Array, opts: Omit<PutOptions, "move" | "onProgress">): Promise<void> {
    await this.client.putObject(assertSafeKey(key), bytes, { contentType: opts.contentType, cacheControl: opts.cacheControl, signal: opts.signal });
  }

  async head(key: string): Promise<StoredObjectInfo | null> {
    return this.client.headObject(assertSafeKey(key));
  }

  async read(key: string, range?: string | null): Promise<ReadResult | "unsatisfiable" | null> {
    // Anything but a single byte range is answered with the whole object, like the local driver.
    const validRange = range && /^bytes=(\d+-\d*|-\d+)$/.test(range.trim()) ? range.trim() : undefined;
    const res = await this.client.getObject(assertSafeKey(key), { range: validRange });
    if (!res) return null;
    if (res.status === 416) {
      await res.body?.cancel().catch(() => undefined);
      return "unsatisfiable";
    }
    if (!res.body) return null;
    const length = Number(res.headers.get("content-length") ?? 0);
    const contentRange = res.headers.get("content-range") ?? undefined;
    const total = contentRange ? Number(/\/(\d+)$/.exec(contentRange)?.[1] ?? length) : length;
    const lastModified = res.headers.get("last-modified");
    return {
      body: res.body,
      status: res.status === 206 ? 206 : 200,
      length,
      size: total,
      contentRange: res.status === 206 ? contentRange : undefined,
      contentType: res.headers.get("content-type") ?? undefined,
      lastModified: lastModified ? new Date(lastModified) : undefined,
      etag: res.headers.get("etag") ?? undefined,
    };
  }

  async readText(key: string, maxBytes: number): Promise<string | null> {
    const res = await this.client.getObject(assertSafeKey(key));
    if (!res?.body) return null;
    if (Number(res.headers.get("content-length") ?? 0) > maxBytes) {
      await res.body.cancel().catch(() => undefined);
      return null;
    }
    const chunks: Uint8Array[] = [];
    let total = 0;
    const reader = res.body.getReader();
    for (let part = await reader.read(); !part.done; part = await reader.read()) {
      total += part.value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(part.value);
    }
    return Buffer.concat(chunks).toString("utf8");
  }

  async delete(key: string): Promise<void> {
    await this.client.deleteObject(assertSafeKey(key));
  }

  async deletePrefix(prefix: string): Promise<number> {
    if (!isSafeStoragePrefix(prefix)) throw new Error("Unsafe storage prefix.");
    const keys = await this.client.listKeys(prefix);
    for (let i = 0; i < keys.length; i += MAX_DELETE_BATCH) {
      const batch = keys.slice(i, i + MAX_DELETE_BATCH);
      let failed: { key: string; code: string; message: string }[];
      try {
        failed = await this.client.deleteObjects(batch);
      } catch (err) {
        // Services without DeleteObjects (or that reject its checksum header): delete one by one.
        if (!(err instanceof S3Error) || ![400, 405, 501].includes(err.status)) throw err;
        await runPool(batch, DELETE_CONCURRENCY, (k) => this.client.deleteObject(k));
        continue;
      }
      if (failed.length) throw new S3Error(500, failed[0]!.code, `${failed.length} of ${batch.length} files could not be deleted: ${failed[0]!.message}`);
    }
    return keys.length;
  }

  async processingInput(key: string, ttlSeconds: number): Promise<ProcessingInput> {
    return { input: this.client.presignGet(assertSafeKey(key), ttlSeconds), type: "url" };
  }
}
