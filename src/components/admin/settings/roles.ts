import type { Role } from "@/lib/types";

/** Role switches shown on member forms. The interface shows translated labels (`shell` roles.*, `admin` shared.roles.*). */
export const ROLE_OPTIONS: { value: Role; label: string; description: string; adminOnly?: boolean }[] = [
  { value: "student", label: "Student", description: "Take courses and follow their progress" },
  { value: "course_creator", label: "Course creator", description: "Create and manage courses, chapters and lessons" },
  { value: "batch_evaluator", label: "Evaluator", description: "Run batches and review and grade submissions" },
  { value: "moderator", label: "Moderator", description: "Oversee every member, all content and the system settings" },
  { value: "admin", label: "Admin", description: "Full access, including site settings, payments and data", adminOnly: true },
];

export const ROLE_VALUES = ROLE_OPTIONS.map((r) => r.value);

export function isRole(value: string): value is Role {
  return (ROLE_VALUES as string[]).includes(value);
}
