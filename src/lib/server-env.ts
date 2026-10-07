import "server-only";
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { siteConfig } from "@/lib/config";

/**
 * Server-only secrets and integration settings read from `.env`.
 * Never import this module from a Client Component.
 */

function read(name: string): string {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : "";
}

let cachedSecret: string | null = null;

/**
 * Application secret used to sign media URLs, encrypt 2FA secrets and sign
 * unsubscribe/calendar links. Uses APP_SECRET when set (required in
 * production); otherwise generates one and persists it next to the database
 * so it survives restarts in development.
 */
export function getAppSecret(): string {
  if (cachedSecret) return cachedSecret;
  const fromEnv = read("APP_SECRET");
  if (fromEnv) {
    if (fromEnv.length < 32) throw new Error("APP_SECRET must be at least 32 characters long.");
    cachedSecret = fromEnv;
    return cachedSecret;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("APP_SECRET is not set. Add a long random value to your .env file (e.g. `openssl rand -hex 32`).");
  }
  const file = path.resolve(/* turbopackIgnore: true */ process.cwd(), path.dirname(siteConfig.dataFile), ".app-secret");
  try {
    cachedSecret = fs.readFileSync(file, "utf8").trim();
    if (cachedSecret.length >= 32) return cachedSecret;
  } catch {
    /* create below */
  }
  cachedSecret = randomBytes(32).toString("hex");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, cachedSecret, { encoding: "utf8", mode: 0o600 });
  return cachedSecret;
}

export type MailTransport = "log" | "smtp";

export const mailEnv = {
  /** "log" (default) stores emails and prints a summary; "smtp" delivers them. */
  transport: (read("MAIL_TRANSPORT") === "smtp" ? "smtp" : "log") as MailTransport,
  host: read("SMTP_HOST"),
  port: Number(read("SMTP_PORT")) || 587,
  /** true = implicit TLS (usually port 465); false = STARTTLS when offered. */
  secure: ["true", "1", "yes"].includes(read("SMTP_SECURE").toLowerCase()),
  user: read("SMTP_USER"),
  pass: read("SMTP_PASS"),
  /** Default sender address, e.g. "LearnLoop <no-reply@example.com>". */
  from: read("MAIL_FROM"),
};

export const stripeEnv = {
  secretKey: read("STRIPE_SECRET_KEY"),
  webhookSecret: read("STRIPE_WEBHOOK_SECRET"),
};

export const razorpayEnv = {
  keyId: read("RAZORPAY_KEY_ID"),
  keySecret: read("RAZORPAY_KEY_SECRET"),
  webhookSecret: read("RAZORPAY_WEBHOOK_SECRET"),
};

/* ------------------------------------------------------------------ */
/* Round 3                                                             */
/* ------------------------------------------------------------------ */

function readBool(name: string, fallback = false): boolean {
  const v = read(name).toLowerCase();
  if (["true", "1", "yes", "on"].includes(v)) return true;
  if (["false", "0", "no", "off"].includes(v)) return false;
  return fallback;
}

export type StorageDriver = "local" | "s3";

/** Where uploaded media is stored: the local upload folder, or any S3-compatible bucket (AWS, R2, MinIO, …). */
export const storageEnv = {
  driver: (read("STORAGE_DRIVER").toLowerCase() === "s3" ? "s3" : "local") as StorageDriver,
  /** e.g. "https://<account>.r2.cloudflarestorage.com" or "http://localhost:9000"; empty = AWS S3 for `region`. */
  endpoint: read("S3_ENDPOINT").replace(/\/+$/, ""),
  region: read("S3_REGION") || "auto",
  bucket: read("S3_BUCKET"),
  accessKeyId: read("S3_ACCESS_KEY_ID"),
  secretAccessKey: read("S3_SECRET_ACCESS_KEY"),
  /** Public (or CDN) origin serving the bucket's objects; empty = serve through the app with signed URLs. */
  publicBaseUrl: read("S3_PUBLIC_BASE_URL").replace(/\/+$/, ""),
  /** Use path-style URLs (`endpoint/bucket/key`), needed by MinIO and some providers. */
  forcePathStyle: readBool("S3_FORCE_PATH_STYLE"),
};

/** True when the S3 driver is selected and has everything it needs. */
export function isS3Configured(): boolean {
  return storageEnv.driver === "s3" && Boolean(storageEnv.bucket && storageEnv.accessKeyId && storageEnv.secretAccessKey);
}

/** ffmpeg/ffprobe binaries used for HLS transcoding and thumbnails. */
export const mediaEnv = {
  ffmpegPath: read("FFMPEG_PATH") || "ffmpeg",
  ffprobePath: read("FFPROBE_PATH") || "ffprobe",
  /** New uploads are refused (507) when the upload disk would have less than this free (UPLOAD_MIN_FREE_MB, default 1024). */
  uploadMinFreeBytes: readMegabytes("UPLOAD_MIN_FREE_MB", 1024),
  /** Bytes a learner (non-staff account) may upload per rolling 24 hours (UPLOAD_LEARNER_DAILY_MB, default 500). */
  learnerDailyUploadBytes: readMegabytes("UPLOAD_LEARNER_DAILY_MB", 500),
};

/** A whole number of megabytes from the environment (0 allowed), in bytes. */
function readMegabytes(name: string, fallbackMb: number): number {
  const raw = read(name);
  const mb = raw && /^\d{1,9}$/.test(raw) ? Number(raw) : fallbackMb;
  return mb * 1024 * 1024;
}

/** OpenAI-compatible speech-to-text endpoint used for automatic captions. */
export const transcribeEnv = {
  /** e.g. "https://api.openai.com/v1/audio/transcriptions" */
  apiUrl: read("TRANSCRIBE_API_URL"),
  apiKey: read("TRANSCRIBE_API_KEY"),
  model: read("TRANSCRIBE_MODEL") || "whisper-1",
};

/** Anthropic API credentials for the AI tutor. */
export const aiEnv = {
  anthropicApiKey: read("ANTHROPIC_API_KEY"),
};

export type DatabaseDriver = "json" | "sqlite" | "postgres";

/** DB_DRIVER: "json", "postgres" (also "postgresql"), anything else is the default "sqlite". */
export function parseDatabaseDriver(value: string | undefined): DatabaseDriver {
  const v = (value ?? "").trim().toLowerCase();
  if (v === "json") return "json";
  if (v === "postgres" || v === "postgresql") return "postgres";
  return "sqlite";
}

/** Which database backend the store uses. */
export const databaseEnv = {
  driver: parseDatabaseDriver(read("DB_DRIVER")),
  /** Relative to the project root, or absolute. With DB_DRIVER=postgres: imported into an empty database, and the backups folder sits next to it. */
  sqlitePath: read("SQLITE_PATH") || "storage/lms.sqlite",
  /** PostgreSQL connection for the app (Supabase: the pooled URL, port 6543, ?pgbouncer=true&connection_limit=…). */
  databaseUrl: read("DATABASE_URL"),
};

/** Mask a secret for display in admin screens: "sk_live_…a1b2". */
export function maskSecret(value: string, visible = 4): string {
  if (!value) return "";
  if (value.length <= visible * 2) return "•".repeat(value.length);
  return `${value.slice(0, Math.min(8, value.length - visible))}…${value.slice(-visible)}`;
}
