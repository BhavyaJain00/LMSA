import "server-only";
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { uid } from "@/lib/utils";
import { assertSafeKey, isSafeStoragePrefix } from "./keys";
import { parseByteRange } from "./range";
import type { PutOptions, ProcessingInput, ReadResult, StorageDriver, StoredObjectInfo } from "./types";

/**
 * Local folder driver: keys map to files below UPLOAD_DIR. Writes go to a
 * hidden temporary file first and are renamed into place, so a reader never
 * sees half a file. Files are served by `/uploads/[...path]`, which applies
 * the real-path protection rules of `src/lib/media/files.ts`.
 */
export class LocalStorage implements StorageDriver {
  readonly kind = "local" as const;
  readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(/* turbopackIgnore: true */ root);
  }

  /** Absolute path of a key (throws for unsafe keys). */
  pathOf(key: string): string {
    const abs = path.join(/* turbopackIgnore: true */ this.root, ...assertSafeKey(key).split("/"));
    if (!abs.startsWith(this.root + path.sep)) throw new Error("Storage key escapes the upload folder.");
    return abs;
  }

  private tempFor(target: string): string {
    return path.join(/* turbopackIgnore: true */ path.dirname(target), `.${path.basename(target)}.${uid()}.part`);
  }

  async putFile(key: string, filePath: string, opts: PutOptions): Promise<void> {
    const target = this.pathOf(key);
    await fs.mkdir(path.dirname(target), { recursive: true });
    if (opts.move) {
      try {
        await fs.rename(filePath, target);
        opts.onProgress?.((await fs.stat(target)).size);
        return;
      } catch (err) {
        // Different volume: fall back to copy + delete.
        if ((err as NodeJS.ErrnoException).code !== "EXDEV") throw err;
      }
    }
    const temp = this.tempFor(target);
    try {
      await fs.copyFile(filePath, temp);
      await fs.rename(temp, target);
    } catch (err) {
      await fs.rm(temp, { force: true }).catch(() => undefined);
      throw err;
    }
    opts.onProgress?.((await fs.stat(target)).size);
    if (opts.move) await fs.rm(filePath, { force: true });
  }

  async putBytes(key: string, bytes: Uint8Array): Promise<void> {
    const target = this.pathOf(key);
    await fs.mkdir(path.dirname(target), { recursive: true });
    const temp = this.tempFor(target);
    try {
      await fs.writeFile(temp, bytes);
      await fs.rename(temp, target);
    } catch (err) {
      await fs.rm(temp, { force: true }).catch(() => undefined);
      throw err;
    }
  }

  async head(key: string): Promise<StoredObjectInfo | null> {
    try {
      const stat = await fs.stat(this.pathOf(key));
      return stat.isFile() ? { size: stat.size, lastModified: stat.mtime } : null;
    } catch {
      return null;
    }
  }

  async read(key: string, range?: string | null): Promise<ReadResult | "unsatisfiable" | null> {
    const file = this.pathOf(key);
    const info = await this.head(key);
    if (!info) return null;
    const parsed = parseByteRange(range, info.size);
    if (parsed === "invalid") return "unsatisfiable";
    if (parsed) {
      const body = Readable.toWeb(createReadStream(file, { start: parsed.start, end: parsed.end })) as ReadableStream<Uint8Array>;
      return {
        body,
        status: 206,
        length: parsed.end - parsed.start + 1,
        size: info.size,
        contentRange: `bytes ${parsed.start}-${parsed.end}/${info.size}`,
        lastModified: info.lastModified,
      };
    }
    const body = Readable.toWeb(createReadStream(file)) as ReadableStream<Uint8Array>;
    return { body, status: 200, length: info.size, size: info.size, lastModified: info.lastModified };
  }

  async readText(key: string, maxBytes: number): Promise<string | null> {
    const info = await this.head(key);
    if (!info || info.size > maxBytes) return null;
    return fs.readFile(this.pathOf(key), "utf8");
  }

  async delete(key: string): Promise<void> {
    await fs.rm(this.pathOf(key), { force: true });
  }

  async deletePrefix(prefix: string): Promise<number> {
    if (!isSafeStoragePrefix(prefix)) throw new Error("Unsafe storage prefix.");
    const dir = this.pathOf(prefix.slice(0, -1));
    const stat = await fs.stat(dir).catch(() => null);
    if (!stat?.isDirectory()) return 0;
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    return 1;
  }

  async processingInput(key: string): Promise<ProcessingInput> {
    return { input: this.pathOf(key), type: "file" };
  }
}
