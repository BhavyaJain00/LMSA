import type { Role } from "@/lib/types";

/** Role switches shown on member forms (labels and descriptions follow Frappe's RoleSwitches). */
export const ROLE_OPTIONS: { value: Role; label: string; description: string; adminOnly?: boolean }[] = [
  { value: "student", label: "Student", description: "Learn courses and track progress" },
  { value: "course_creator", label: "Course Creator", description: "Build and manage courses, chapters, and lessons" },
  { value: "batch_evaluator", label: "Evaluator", description: "Manage batches, review and grade submissions" },
  { value: "moderator", label: "Moderator", description: "Oversee all users, content, and system settings" },
  { value: "admin", label: "Admin", description: "Full access, including site settings, payments and data", adminOnly: true },
];

export const ROLE_VALUES = ROLE_OPTIONS.map((r) => r.value);

export function isRole(value: string): value is Role {
  return (ROLE_VALUES as string[]).includes(value);
}
