import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { backupsDirFor, rawDataFromJson, rawDataToJson, type RawData } from "./sqlite-core.mjs";
import type { OpenResult, StorageInfo, StoreDriver } from "./driver";

/**
 * The original storage: the whole database in one JSON file, rewritten
 * atomically (temp file + rename) on every flush. Selected with
 * DB_DRIVER=json; fine for development and small sites.
 */
export class JsonDriver implements StoreDriver {
  readonly kind = "json" as const;
  readonly incremental = false;
  readonly backupsDir: string;

  constructor(private readonly file: string) {
    this.backupsDir = backupsDirFor(file);
  }

  async open(initialData: () => Promise<RawData>): Promise<OpenResult> {
    let text: string;
    try {
      text = await fsp.readFile(this.file, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      const data = await initialData();
      await this.write(data);
      return { data, origin: "seeded" };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text.replace(/^﻿/, ""));
    } catch (err) {
      throw new Error(
        `The database file ${this.file} is not valid JSON (${err instanceof Error ? err.message : String(err)}). Restore a backup from ${this.backupsDir} with "npm run db:restore -- <file>".`,
      );
    }
    return { data: rawDataFromJson(parsed), origin: "existing" };
  }

  async persist(data: RawData): Promise<void> {
    await this.write(data);
  }

  async replaceAll(data: RawData): Promise<void> {
    await this.write(data);
  }

  hasExternalChanges(): boolean {
    return false;
  }

  reload(): RawData {
    return rawDataFromJson(JSON.parse(fs.readFileSync(this.file, "utf8").replace(/^﻿/, "")));
  }

  async backupTo(target: string, data: RawData): Promise<void> {
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.writeFile(target, rawDataToJson(data), { encoding: "utf8", flag: "wx" });
  }

  checkIntegrity(): { ok: boolean; messages: string[] } {
    try {
      this.reload();
      return { ok: true, messages: ["ok"] };
    } catch (err) {
      return { ok: false, messages: [err instanceof Error ? err.message : String(err)] };
    }
  }

  info(): StorageInfo {
    let sizeBytes: number | null = null;
    let modifiedAt: string | null = null;
    try {
      const stat = fs.statSync(this.file);
      sizeBytes = stat.size;
      modifiedAt = stat.mtime.toISOString();
    } catch {
      // Not written yet.
    }
    return { driver: "json", file: this.file, sizeBytes, walBytes: null, modifiedAt, sqliteVersion: null, schemaVersion: null, meta: {} };
  }

  close(): void {
    // Nothing held open.
  }

  private async write(data: RawData): Promise<void> {
    await fsp.mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    await fsp.writeFile(tmp, rawDataToJson(data), "utf8");
    await fsp.rename(tmp, this.file);
  }
}
