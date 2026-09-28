/**
 * Static configuration. Runtime-editable branding and feature toggles live in
 * the Settings record (see src/lib/db/defaults.ts) and are managed from the
 * admin Settings page.
 */
export const siteConfig = {
  /** Fallback name used before settings load. */
  name: "LearnLoop",
  /** Max upload size in bytes (default 2 GB for videos). */
  maxUploadBytes: 2 * 1024 * 1024 * 1024,
  /** Max upload size for images/documents (default 25 MB). */
  maxAssetBytes: 25 * 1024 * 1024,
  /** Session lifetime in days. */
  sessionDays: 30,
  /** Name of the auth cookie. */
  sessionCookie: "ll_session",
  /** Where uploaded files are stored (relative to project root). */
  uploadDir: "storage/uploads",
  /** Where the JSON database lives (relative to project root). */
  dataFile: "storage/db.json",
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
