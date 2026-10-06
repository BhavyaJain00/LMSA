import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { NextResponse } from "next/server";
import { siteConfig } from "@/lib/config";
import { databaseEnv, mediaEnv } from "@/lib/server-env";
import { getDb } from "@/lib/db/store";
import { getCurrentUser, isAdmin } from "@/lib/auth/session";
import { publicHealthReport, type HealthCheck as Check, type HealthReport } from "./report";

/**
 * GET /api/health — liveness/readiness probe for Docker, load balancers and
 * uptime monitors. Public and secret-free: anonymous callers only learn
 * whether the database answers, the storage folders are writable and ffmpeg
 * is present, plus the app version. Signed-in administrators also see the
 * ffmpeg build, per-check timings and the process uptime (see `report.ts`).
 *
 * 200 = healthy (ffmpeg missing only degrades: videos fall back to MP4);
 * 503 = the database or storage is failing. Results are cached for a few
 * seconds so the endpoint cannot be used to load the server.
 */

export const dynamic = "force-dynamic";

const CACHE_MS = 5_000;
const FFMPEG_CACHE_MS = 5 * 60_000;

const g = globalThis as unknown as {
  __llHealth?: { report: HealthReport; at: number } | null;
  __llHealthFfmpeg?: { check: Check; at: number } | null;
  __llHealthVersion?: string;
};

async function timed(fn: () => Promise<string | undefined>): Promise<Check> {
  const started = performance.now();
  try {
    const detail = await fn();
    return { ok: true, ms: Math.round(performance.now() - started), ...(detail ? { detail } : {}) };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    return { ok: false, ms: Math.round(performance.now() - started), detail: code ? `failed (${code})` : "failed" };
  }
}

async function checkDatabase(): Promise<string | undefined> {
  const db = await getDb();
  if (!db.settings || !Array.isArray(db.users)) throw new Error("database not loaded");
  return undefined;
}

/** Write and remove a probe file in the database and upload folders. */
async function checkStorage(): Promise<string | undefined> {
  const root = process.cwd();
  const dataFile = databaseEnv.driver === "sqlite" ? databaseEnv.sqlitePath : siteConfig.dataFile;
  const dirs = Array.from(new Set([path.dirname(dataFile), siteConfig.uploadDir].map((d) => path.resolve(/* turbopackIgnore: true */ root, d))));
  for (const dir of dirs) {
    await fs.mkdir(dir, { recursive: true });
    const probe = path.join(dir, `.health-${process.pid}-${Date.now()}`);
    await fs.writeFile(probe, "ok");
    await fs.unlink(probe);
  }
  return undefined;
}

function ffmpegVersion(): Promise<string | undefined> {
  return new Promise((resolve, reject) => {
    execFile(mediaEnv.ffmpegPath, ["-hide_banner", "-version"], { timeout: 3_000, windowsHide: true }, (err, stdout) => {
      if (err) return reject(err);
      const match = /ffmpeg version (\S+)/.exec(String(stdout));
      resolve(match ? match[1]!.slice(0, 40) : undefined);
    });
  });
}

async function checkFfmpeg(): Promise<Check> {
  const cached = g.__llHealthFfmpeg;
  if (cached && Date.now() - cached.at < FFMPEG_CACHE_MS) return cached.check;
  const check = await timed(ffmpegVersion);
  if (!check.ok) check.detail = "not found — videos are served as MP4 without adaptive streaming";
  g.__llHealthFfmpeg = { check, at: Date.now() };
  return check;
}

async function appVersion(): Promise<string> {
  if (g.__llHealthVersion) return g.__llHealthVersion;
  let version = process.env.APP_VERSION?.trim() || "";
  if (!version) {
    try {
      const pkg = JSON.parse(await fs.readFile(path.join(/* turbopackIgnore: true */ process.cwd(), "package.json"), "utf8")) as { version?: unknown };
      version = typeof pkg.version === "string" ? pkg.version : "";
    } catch {
      version = "";
    }
  }
  g.__llHealthVersion = version.slice(0, 40) || "unknown";
  return g.__llHealthVersion;
}

async function buildReport(): Promise<HealthReport> {
  const [database, storage, ffmpeg, version] = await Promise.all([timed(checkDatabase), timed(checkStorage), checkFfmpeg(), appVersion()]);
  const status: HealthReport["status"] = !database.ok || !storage.ok ? "error" : ffmpeg.ok ? "ok" : "degraded";
  return {
    status,
    version,
    uptimeSeconds: Math.round(process.uptime()),
    checkedAt: new Date().toISOString(),
    checks: { database, storage, ffmpeg },
  };
}

export async function GET() {
  const cached = g.__llHealth;
  const report = cached && Date.now() - cached.at < CACHE_MS ? cached.report : await buildReport();
  if (!cached || cached.report !== report) g.__llHealth = { report, at: Date.now() };
  let admin = false;
  try {
    admin = isAdmin(await getCurrentUser());
  } catch {
    admin = false;
  }
  return NextResponse.json(admin ? report : publicHealthReport(report), {
    status: report.status === "error" ? 503 : 200,
    headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" },
  });
}

export async function HEAD() {
  const response = await GET();
  return new NextResponse(null, { status: response.status, headers: response.headers });
}
