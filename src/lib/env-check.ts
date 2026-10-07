/**
 * Startup configuration checks, run from `register()` in
 * `src/instrumentation.ts` and shown to administrators on the error log page.
 *
 * In production a missing or short APP_SECRET, or an APP_URL that is not
 * HTTPS, stops the server from starting: media signing, 2FA encryption,
 * unsubscribe and calendar links all depend on the secret, and cookies,
 * emails, payment callbacks and canonical URLs on the URL. So does a
 * standalone server (`node .next/standalone/server.js`, which changes into
 * its own folder) whose data paths are relative: the database and uploads
 * would live inside the build output, which the next `next build` deletes.
 * Everything else is a warning. Checks never run during `next build`.
 *
 * Pure apart from `runStartupChecks` (which only logs or throws), so the
 * rules are unit tested directly. Values are never echoed back.
 */

export type EnvIssueLevel = "error" | "warning";

export interface EnvIssue {
  level: EnvIssueLevel;
  /** Environment variable the issue is about. */
  key: string;
  message: string;
}

export interface EnvCheckResult {
  production: boolean;
  errors: EnvIssue[];
  warnings: EnvIssue[];
}

type Env = Record<string, string | undefined>;

const MIN_SECRET_LENGTH = 32;
const TRUE = ["true", "1", "yes", "on"];
const FALSE = ["false", "0", "no", "off"];

function value(env: Env, key: string): string {
  const v = env[key];
  return typeof v === "string" ? v.trim() : "";
}

/** An absolute POSIX or Windows path (`/var/lib/x`, `C:\data\x`, `\\server\share`). */
function isAbsolutePath(p: string): boolean {
  return p.startsWith("/") || p.startsWith("\\\\") || /^[A-Za-z]:[\\/]/.test(p);
}

/**
 * True when `cwd` is inside a Next standalone build folder. The generated
 * `server.js` runs `process.chdir(__dirname)`, so relative data paths resolve
 * inside `.next/standalone`, and `next build` empties `.next`.
 */
export function isInsideBuildOutput(cwd: string): boolean {
  return /[\\/]\.next[\\/]standalone(?:[\\/]|$)/.test(cwd);
}

/** Data-path variables that must be absolute for a standalone server, with their defaults. */
const DATA_PATH_DEFAULTS: { key: string; fallback: string; when?: (env: Env) => boolean }[] = [
  { key: "SQLITE_PATH", fallback: "storage/lms.sqlite", when: (env) => value(env, "DB_DRIVER").toLowerCase() !== "json" },
  // Also decides where the app secret file, storage/seo and (JSON driver) backups live.
  { key: "DATA_FILE", fallback: "storage/db.json" },
  { key: "UPLOAD_DIR", fallback: "storage/uploads" },
];

function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1" || hostname.endsWith(".localhost");
}

/**
 * Evaluate the rules for `env`. `production` means NODE_ENV=production;
 * `cwd` is the server's working directory (the data-path rule is skipped without it).
 */
export function checkEnvironment(env: Env, options: { production: boolean; cwd?: string }): EnvCheckResult {
  const { production } = options;
  const errors: EnvIssue[] = [];
  const warnings: EnvIssue[] = [];
  /** Hard requirement in production, warning in development. */
  const required = (key: string, message: string) => (production ? errors : warnings).push({ level: production ? "error" : "warning", key, message });
  const warn = (key: string, message: string) => warnings.push({ level: "warning", key, message });
  const fail = (key: string, message: string) => errors.push({ level: "error", key, message });

  // APP_SECRET
  const secret = value(env, "APP_SECRET");
  if (!secret) {
    required(
      "APP_SECRET",
      production
        ? "APP_SECRET is not set. Generate one with `openssl rand -hex 32` and add it to the environment."
        : "APP_SECRET is not set; a development secret is generated and stored next to the database.",
    );
  } else if (secret.length < MIN_SECRET_LENGTH) {
    required("APP_SECRET", `APP_SECRET must be at least ${MIN_SECRET_LENGTH} characters long (it signs media URLs and encrypts 2FA secrets).`);
  }

  // APP_URL
  const appUrl = value(env, "APP_URL");
  let url: URL | null = null;
  if (!appUrl) {
    required("APP_URL", "APP_URL is not set, so links in emails and payment callbacks point at http://localhost:3000.");
  } else {
    try {
      url = new URL(appUrl);
    } catch {
      required("APP_URL", "APP_URL is not a valid URL (expected something like https://learn.example.com).");
    }
  }
  if (url) {
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      required("APP_URL", "APP_URL must start with https://.");
    } else if (url.protocol === "http:") {
      if (!production) {
        // Normal for local development.
      } else if (isLoopbackHost(url.hostname)) {
        warn("APP_URL", "APP_URL uses http on a local address. Use the public https:// address before going live.");
      } else {
        fail("APP_URL", "APP_URL must use https:// in production (secure cookies, payment callbacks and search engines need it).");
      }
    }
    if (url.pathname !== "/" && url.pathname !== "") warn("APP_URL", "APP_URL should be the site's origin without a path; the app is served from the root.");
    if (production && url.protocol === "https:" && FALSE.includes(value(env, "COOKIE_SECURE").toLowerCase())) {
      warn("COOKIE_SECURE", "COOKIE_SECURE=false sends the sign-in cookie over plain HTTP too. Remove it when the site is served over HTTPS.");
    }
  }

  // Demo data and development switches.
  if (production) {
    const seed = value(env, "SEED_DEMO_DATA").toLowerCase();
    if (!FALSE.includes(seed)) {
      warn("SEED_DEMO_DATA", "SEED_DEMO_DATA is not false: a new database starts with demo accounts whose passwords are public. Set SEED_DEMO_DATA=false and remove demo accounts before launch.");
    }
    if (value(env, "LL_DEV_LOGIN")) warn("LL_DEV_LOGIN", "LL_DEV_LOGIN is ignored in production; remove it from the environment.");
    if (value(env, "DB_DRIVER").toLowerCase() === "json") warn("DB_DRIVER", "DB_DRIVER=json rewrites the whole database file on every change. Use the default SQLite driver in production.");
  }

  // Database driver.
  checkDatabase(env, { fail, warn });

  // Data inside the build output is deleted by the next `next build`.
  if (production && options.cwd && isInsideBuildOutput(options.cwd)) {
    for (const spec of DATA_PATH_DEFAULTS) {
      if (spec.when && !spec.when(env)) continue;
      const configured = value(env, spec.key) || spec.fallback;
      if (isAbsolutePath(configured)) continue;
      fail(
        spec.key,
        `${spec.key} is a relative path and the server runs from .next/standalone, so the data would be stored inside the build output and deleted by the next \`npm run build\`. Set SQLITE_PATH, DATA_FILE and UPLOAD_DIR to absolute paths outside the project folder (see DEPLOYMENT.md, "Without Docker").`,
      );
    }
  }

  // Reverse proxy.
  const hopsRaw = value(env, "TRUST_PROXY_HOPS");
  if (hopsRaw && !/^\d+$/.test(hopsRaw)) {
    warn("TRUST_PROXY_HOPS", "TRUST_PROXY_HOPS must be a whole number (0 = no proxy, 1 = one reverse proxy such as Caddy or nginx).");
  } else if (production && (!hopsRaw || hopsRaw === "0")) {
    warn("TRUST_PROXY_HOPS", "TRUST_PROXY_HOPS is 0, so client IPs are unknown and per-IP rate limits are shared by everyone. Set it to 1 behind a single reverse proxy.");
  }

  // Email.
  const transport = value(env, "MAIL_TRANSPORT").toLowerCase();
  if (transport === "smtp") {
    if (!value(env, "SMTP_HOST")) fail("SMTP_HOST", "MAIL_TRANSPORT=smtp but SMTP_HOST is empty, so no email can be delivered.");
    if (!value(env, "MAIL_FROM")) warn("MAIL_FROM", "MAIL_FROM is empty; emails are sent from a generic no-reply address.");
    if (FALSE.includes(value(env, "SMTP_REQUIRE_TLS").toLowerCase())) warn("SMTP_REQUIRE_TLS", "SMTP_REQUIRE_TLS=false lets password-reset links travel unencrypted.");
  } else if (production) {
    warn("MAIL_TRANSPORT", "MAIL_TRANSPORT is not smtp: emails (password resets, receipts) are stored in the outbox but never delivered.");
  }

  // Payments: a key without its webhook secret means paid orders are only confirmed when the buyer returns.
  if (value(env, "STRIPE_SECRET_KEY") && !value(env, "STRIPE_WEBHOOK_SECRET")) {
    warn("STRIPE_WEBHOOK_SECRET", "STRIPE_SECRET_KEY is set without STRIPE_WEBHOOK_SECRET; payments that complete after the buyer closes the tab are not confirmed.");
  }
  if (production && /^sk_test_/.test(value(env, "STRIPE_SECRET_KEY"))) warn("STRIPE_SECRET_KEY", "Stripe is in test mode; no real payments are taken.");
  if (value(env, "RAZORPAY_KEY_ID") && !value(env, "RAZORPAY_KEY_SECRET")) fail("RAZORPAY_KEY_SECRET", "RAZORPAY_KEY_ID is set without RAZORPAY_KEY_SECRET.");
  if (value(env, "RAZORPAY_KEY_ID") && !value(env, "RAZORPAY_WEBHOOK_SECRET")) {
    warn("RAZORPAY_WEBHOOK_SECRET", "RAZORPAY_KEY_ID is set without RAZORPAY_WEBHOOK_SECRET; refunds and late payments are not picked up.");
  }

  // Object storage.
  if (value(env, "STORAGE_DRIVER").toLowerCase() === "s3") {
    const missing = ["S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"].filter((k) => !value(env, k));
    if (missing.length) fail(missing[0]!, `STORAGE_DRIVER=s3 needs ${missing.join(", ")}; uploads would fail.`);
    const cdn = value(env, "S3_PUBLIC_BASE_URL");
    if (cdn && production && !/^https:\/\//i.test(cdn)) warn("S3_PUBLIC_BASE_URL", "S3_PUBLIC_BASE_URL should use https:// or browsers block the media on an HTTPS site.");
  }

  // Integrations configured by halves.
  if (value(env, "TRANSCRIBE_API_URL") && !value(env, "TRANSCRIBE_API_KEY")) warn("TRANSCRIBE_API_KEY", "TRANSCRIBE_API_URL is set without TRANSCRIBE_API_KEY; automatic captions will fail.");

  const session = value(env, "SESSION_DAYS");
  if (session && !(Number(session) > 0)) warn("SESSION_DAYS", "SESSION_DAYS must be a positive number of days; the default (30) is used.");
  const secureFlag = value(env, "COOKIE_SECURE").toLowerCase();
  if (secureFlag && !TRUE.includes(secureFlag) && !FALSE.includes(secureFlag)) warn("COOKIE_SECURE", "COOKIE_SECURE must be true or false.");

  return { production, errors, warnings };
}

const DB_DRIVERS = ["sqlite", "json", "postgres", "postgresql"];

/** DB_DRIVER and, for PostgreSQL, DATABASE_URL / DIRECT_URL. */
function checkDatabase(env: Env, report: { fail: (key: string, message: string) => void; warn: (key: string, message: string) => void }): void {
  const driver = value(env, "DB_DRIVER").toLowerCase();
  if (driver && !DB_DRIVERS.includes(driver)) {
    report.warn("DB_DRIVER", "DB_DRIVER must be sqlite, json or postgres; the default SQLite driver is used.");
    return;
  }
  if (driver !== "postgres" && driver !== "postgresql") return;
  const raw = value(env, "DATABASE_URL");
  if (!raw) {
    report.fail("DATABASE_URL", "DB_DRIVER=postgres needs DATABASE_URL (Supabase: Project Settings → Database → Connection string, the pooled URL on port 6543).");
    return;
  }
  let url: URL | null = null;
  try {
    url = new URL(raw);
  } catch {
    url = null;
  }
  if (!url || (url.protocol !== "postgresql:" && url.protocol !== "postgres:")) {
    report.fail("DATABASE_URL", "DATABASE_URL must be a postgresql:// connection string.");
    return;
  }
  // Supabase's transaction pooler (port 6543) does not support prepared statements: Prisma must be told.
  if (url.port === "6543" && url.searchParams.get("pgbouncer") !== "true") {
    report.warn("DATABASE_URL", "DATABASE_URL uses the transaction pooler (port 6543) without ?pgbouncer=true; add it (and connection_limit=1…5) or queries fail.");
  }
  if (!value(env, "DIRECT_URL")) {
    report.warn("DIRECT_URL", "DIRECT_URL is not set; `npm run prisma:migrate` needs it (Supabase: the direct or session-pooler connection on port 5432). It may equal DATABASE_URL without a pooler.");
  }
}

/** True while `next build` runs (checks are skipped: build machines rarely have runtime secrets). */
export function isBuildPhase(env: Env = process.env): boolean {
  return value(env, "NEXT_PHASE") === "phase-production-build";
}

const g = globalThis as unknown as { __llEnvCheck?: EnvCheckResult };

/** Result of the checks run at startup (computed on demand if they have not run yet). */
export function getStartupCheckResult(): EnvCheckResult {
  return (g.__llEnvCheck ??= checkEnvironment(process.env, { production: process.env.NODE_ENV === "production", cwd: process.cwd() }));
}

/**
 * Run the checks: log warnings, and in production throw (stopping the
 * server) when a required setting is missing. Skipped during `next build`.
 */
export function runStartupChecks(): EnvCheckResult | null {
  if (isBuildPhase()) return null;
  const result = checkEnvironment(process.env, { production: process.env.NODE_ENV === "production", cwd: process.cwd() });
  g.__llEnvCheck = result;
  for (const issue of result.warnings) console.warn(`[config] ${issue.key}: ${issue.message}`);
  if (result.errors.length) {
    const lines = result.errors.map((e) => `  - ${e.key}: ${e.message}`).join("\n");
    if (result.production) {
      throw new Error(`Refusing to start: fix these settings in the environment (see DEPLOYMENT.md).\n${lines}`);
    }
    console.warn(`[config] These settings are required in production:\n${lines}`);
  }
  return result;
}
