/**
 * Deployment configuration, read from environment variables (see .env.example).
 * Runtime-editable branding and feature toggles live in the Settings record
 * (see src/lib/db/defaults.ts) and are managed from Admin → Settings.
 *
 * Only server code should rely on these values: browsers do not see
 * non-NEXT_PUBLIC_ variables, so client bundles fall back to the defaults.
 */
function envString(name: string, fallback: string): string {
  const v = typeof process !== "undefined" ? process.env[name] : undefined;
  return v && v.trim() ? v.trim() : fallback;
}

function envNumber(name: string, fallback: number): number {
  const v = Number(envString(name, ""));
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

/** "true"/"1"/"yes"/"on" → true, "false"/"0"/"no"/"off" → false, anything else → fallback. */
function envBool(name: string, fallback: boolean): boolean {
  const v = envString(name, "").toLowerCase();
  if (["true", "1", "yes", "on"].includes(v)) return true;
  if (["false", "0", "no", "off"].includes(v)) return false;
  return fallback;
}

const MB = 1024 * 1024;

export const siteConfig = {
  /** Fallback name used before settings load. */
  name: "LearnLoop",
  /** Public base URL (no trailing slash), used for absolute links and metadata. */
  appUrl: envString("APP_URL", "http://localhost:3000").replace(/\/+$/, ""),
  /** Max upload size in bytes for videos (default 10 GB; uploads are resumable and chunked). */
  maxUploadBytes: envNumber("MAX_VIDEO_UPLOAD_MB", 10240) * MB,
  /** Max upload size in bytes for images/documents/audio (default 25 MB). */
  maxAssetBytes: envNumber("MAX_FILE_UPLOAD_MB", 25) * MB,
  /** Session lifetime in days. */
  sessionDays: envNumber("SESSION_DAYS", 30),
  /** Name of the auth cookie. */
  sessionCookie: envString("SESSION_COOKIE_NAME", "ll_session"),
  /** Send the auth cookie only over HTTPS. Defaults to true in production. */
  cookieSecure: envBool("COOKIE_SECURE", process.env.NODE_ENV === "production"),
  /** Where uploaded files are stored (relative to the project root, or absolute). */
  uploadDir: envString("UPLOAD_DIR", "storage/uploads"),
  /**
   * Folder for the app's own files besides uploads: database backups (JSON
   * exports, in `backups/`), SEO files (`seo/`) and, in development, the
   * generated app secret. Relative to the project root, or absolute.
   */
  storageDir: envString("STORAGE_DIR", "storage"),
  /** On first run, load the demo courses and users (true) or start empty with one admin (false). */
  seedDemoData: envBool("SEED_DEMO_DATA", true),
  /** First admin account created when SEED_DEMO_DATA=false. */
  bootstrapAdmin: {
    name: envString("ADMIN_NAME", "Administrator"),
    email: envString("ADMIN_EMAIL", ""),
    password: envString("ADMIN_PASSWORD", ""),
  },
} as const;

export const levels = [
  { value: "beginner", label: "Beginner" },
  { value: "intermediate", label: "Intermediate" },
  { value: "advanced", label: "Advanced" },
] as const;

export const cardGradients = [
  "red",
  "blue",
  "green",
  "amber",
  "cyan",
  "orange",
  "pink",
  "purple",
  "teal",
  "violet",
  "yellow",
] as const;

export const roleLabels: Record<string, string> = {
  student: "Student",
  course_creator: "Course Creator",
  moderator: "Moderator",
  batch_evaluator: "Evaluator",
  admin: "Admin",
};

export const currencies = ["USD", "EUR", "GBP", "INR", "AUD", "CAD", "SGD", "AED", "JPY"] as const;

export const timezones = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Paris",
  "Africa/Lagos",
  "Africa/Nairobi",
  "Asia/Dubai",
  "Asia/Karachi",
  "Asia/Kolkata",
  "Asia/Dhaka",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
] as const;

export const exerciseLanguages = [
  { value: "javascript", label: "JavaScript" },
  { value: "typescript", label: "TypeScript" },
  { value: "python", label: "Python" },
  { value: "go", label: "Go" },
  { value: "rust", label: "Rust" },
] as const;

export const assignmentTypes = [
  { value: "text", label: "Text" },
  { value: "url", label: "URL" },
  { value: "document", label: "Document" },
  { value: "pdf", label: "PDF" },
  { value: "image", label: "Image" },
] as const;

export const jobTypes = [
  { value: "full_time", label: "Full time" },
  { value: "part_time", label: "Part time" },
  { value: "contract", label: "Contract" },
  { value: "freelance", label: "Freelance" },
  { value: "internship", label: "Internship" },
] as const;

export const noteColors = ["yellow", "green", "blue", "purple", "red"] as const;
