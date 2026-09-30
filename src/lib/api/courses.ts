import "server-only";
import { after } from "next/server";
import { revalidatePath } from "next/cache";
import type { CardGradient, Course, Database } from "@/lib/types";
import { cardGradients } from "@/lib/config";
import { mutate } from "@/lib/db/store";
import { RESERVED_COURSE_SLUGS } from "@/lib/data/admin-courses";
import { isBlockedVideoHost } from "@/components/admin/courses/blocks";
import { syncContentIndex } from "@/lib/seo/content-sync";
import { toDateKey, uid, uniqueSlug } from "@/lib/utils";
import type { endpoints } from "./endpoints";
import { conflict, notFound, validationError } from "./errors";
import type { Infer } from "./schema";

/**
 * Course writes through the API (POST /courses, PATCH /courses/{id}).
 *
 * Applies the same rules as the course editor: unique, non-reserved slugs;
 * instructors must be course creators, moderators or admins; no
 * YouTube/Vimeo videos; paid courses need a price and a payment gateway;
 * a course can't offer both a paid certificate and a free one. Publishing
 * through the API marks the course approved (keys are created by admins).
 */

export type CourseInput = Infer<(typeof endpoints)["updateCourse"]["body"]>;

const INSTRUCTOR_ROLES = new Set(["course_creator", "moderator", "admin"]);

function isEligibleInstructor(db: Database, id: string): boolean {
  const user = db.users.find((u) => u.id === id);
  return !!user && user.enabled && user.roles.some((r) => INSTRUCTOR_ROLES.has(r));
}

/** Collapse inner whitespace of single-line text. */
function line(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Validate `input` against the current data and return the fields to write.
 * `existing` is null when creating. Throws `ApiError` (400/409).
 */
export function buildCourseChanges(db: Database, input: CourseInput, existing: Course | null, actorId: string, now: Date = new Date()): Partial<Course> {
  const details: Record<string, string> = {};
  const changes: Partial<Course> = {};

  if (input.title !== undefined) changes.title = line(input.title);
  if (input.shortIntroduction !== undefined) changes.shortIntroduction = line(input.shortIntroduction);
  if (input.description !== undefined) changes.description = input.description;

  if (input.slug !== undefined && input.slug !== existing?.slug) {
    if (RESERVED_COURSE_SLUGS.includes(input.slug)) details.slug = `"${input.slug}" is reserved. Pick another slug.`;
    else if (db.courses.some((c) => c.slug === input.slug && c.id !== existing?.id)) {
      throw conflict(`Another course already uses the slug "${input.slug}".`, { slug: "This slug is already used by another course." });
    } else changes.slug = input.slug;
  }

  if (input.imageUrl !== undefined) changes.imageUrl = input.imageUrl ?? undefined;
  if (input.videoUrl !== undefined) {
    if (input.videoUrl && isBlockedVideoHost(input.videoUrl)) details.videoUrl = "YouTube and Vimeo links can't be used. Upload the video or use a direct .mp4/.webm URL.";
    else changes.videoUrl = input.videoUrl ?? undefined;
  }
  if (input.categoryId !== undefined) {
    if (input.categoryId && !db.categories.some((c) => c.id === input.categoryId)) details.categoryId = `No category with id "${input.categoryId}".`;
    else changes.categoryId = input.categoryId ?? undefined;
  }
  if (input.tags !== undefined) changes.tags = input.tags.map(line).filter(Boolean);
  if (input.outcomes !== undefined) changes.outcomes = input.outcomes.map(line).filter(Boolean);
  if (input.requirements !== undefined) changes.requirements = input.requirements.map(line).filter(Boolean);
  if (input.metaDescription !== undefined) changes.metaDescription = input.metaDescription ? line(input.metaDescription) : undefined;

  if (input.instructorIds !== undefined) {
    if (!input.instructorIds.length) details.instructorIds = "Add at least one instructor.";
    else {
      const invalid = input.instructorIds.filter((id) => !isEligibleInstructor(db, id));
      if (invalid.length) details.instructorIds = `Not an enabled course creator, moderator or admin: ${invalid.join(", ")}.`;
      else changes.instructorIds = [...input.instructorIds];
    }
  } else if (!existing) {
    if (isEligibleInstructor(db, actorId)) changes.instructorIds = [actorId];
    else details.instructorIds = "Required: the member who created this API key can't teach courses, so name at least one instructor.";
  }

  for (const flag of ["featured", "upcoming", "enableCertification"] as const) {
    if (input[flag] !== undefined) changes[flag] = input[flag];
  }
  if (input.currency !== undefined) changes.currency = input.currency;
  if (input.price !== undefined) changes.price = input.price;
  if (input.paidCourse !== undefined) changes.paidCourse = input.paidCourse;

  // Rules on the resulting course (sent fields over the current values).
  const paidCourse = changes.paidCourse ?? existing?.paidCourse ?? false;
  const price = changes.price ?? existing?.price ?? 0;
  if (paidCourse) {
    if (price <= 0) details.price = "A paid course needs a price above 0 (in the smallest currency unit, e.g. 4900 for 49.00).";
    if (!existing?.paidCourse && db.settings.commerce.paymentGateway === "none") {
      details.paidCourse = "Selling a paid course needs a payment gateway. Configure one in Admin → Settings → Payments first.";
    }
  } else if (price > 0 && input.price !== undefined) {
    details.price = "Set paidCourse to true to sell the course, or send price 0.";
  } else if (!paidCourse && existing?.paidCourse && input.paidCourse === false) {
    changes.price = 0;
  }
  const enableCertification = changes.enableCertification ?? existing?.enableCertification ?? false;
  if (enableCertification && existing?.paidCertificate) {
    details.enableCertification = "This course sells a certificate, so it can't also issue a free certificate of completion. Change it in the course settings.";
  }

  if (input.published !== undefined && input.published !== (existing?.published ?? false)) {
    changes.published = input.published;
    if (input.published) {
      changes.publishedOn = existing?.publishedOn ?? toDateKey(now);
      changes.status = "approved";
    }
  }

  if (Object.keys(details).length) throw validationError(details);
  return changes;
}

/** Everything a new course needs besides the API input. */
export function newCourse(db: Database, changes: Partial<Course>, actorId: string, now: Date = new Date()): Course {
  const title = changes.title ?? "";
  const slug = changes.slug ?? uniqueSlug(title, [...db.courses.map((c) => c.slug), ...RESERVED_COURSE_SLUGS]);
  const iso = now.toISOString();
  const gradient: CardGradient = cardGradients[Math.floor(Math.random() * cardGradients.length)]!;
  return {
    id: uid("crs"),
    slug,
    title,
    shortIntroduction: changes.shortIntroduction ?? "",
    description: changes.description ?? "",
    imageUrl: changes.imageUrl,
    videoUrl: changes.videoUrl,
    cardGradient: gradient,
    instructorIds: changes.instructorIds ?? [actorId],
    categoryId: changes.categoryId,
    tags: changes.tags ?? [],
    price: changes.price ?? 0,
    currency: changes.currency ?? (db.settings.commerce.defaultCurrency || "USD"),
    paidCourse: changes.paidCourse ?? false,
    paidCertificate: false,
    certificatePrice: 0,
    enableCertification: changes.enableCertification ?? false,
    published: changes.published ?? false,
    publishedOn: changes.publishedOn,
    upcoming: changes.upcoming ?? false,
    featured: changes.featured ?? false,
    disableSelfLearning: false,
    enforceLessonCompletion: false,
    status: changes.status ?? "in_progress",
    relatedCourseIds: [],
    outcomes: changes.outcomes ?? [],
    requirements: changes.requirements ?? [],
    metaDescription: changes.metaDescription,
    createdById: actorId,
    createdAt: iso,
    updatedAt: iso,
  };
}

/** Store a new course; the slug is re-checked inside the serialized write. */
export async function insertCourse(course: Course): Promise<Course> {
  const saved = await mutate((d) => {
    if (d.courses.some((c) => c.slug === course.slug)) return null;
    d.courses.push(course);
    return course;
  });
  if (!saved) throw conflict(`Another course already uses the slug "${course.slug}".`, { slug: "This slug is already used by another course." });
  return saved;
}

/** Apply changes to a stored course; the slug is re-checked inside the serialized write. */
export async function applyCourseChanges(courseId: string, changes: Partial<Course>, now: Date = new Date()): Promise<{ before: Course; after: Course }> {
  const result = await mutate((d): { before: Course; after: Course } | "missing" | "slug" => {
    const index = d.courses.findIndex((c) => c.id === courseId);
    const current = d.courses[index];
    if (!current) return "missing";
    if (changes.slug && d.courses.some((c) => c.slug === changes.slug && c.id !== courseId)) return "slug";
    const next: Course = { ...current, ...changes, updatedAt: now.toISOString() };
    d.courses[index] = next;
    return { before: current, after: next };
  });
  if (result === "missing") throw notFound("course", courseId);
  if (result === "slug") throw conflict(`Another course already uses the slug "${changes.slug}".`, { slug: "This slug is already used by another course." });
  return result;
}

/** Refresh cached pages and search-engine state after a course changed. */
export function afterCourseWrite(course: Pick<Course, "id" | "slug">, previousSlug?: string): void {
  revalidatePath("/courses");
  revalidatePath(`/courses/${course.slug}`, "layout");
  if (previousSlug && previousSlug !== course.slug) revalidatePath(`/courses/${previousSlug}`, "layout");
  revalidatePath("/admin/courses");
  revalidatePath(`/admin/courses/${course.id}`, "layout");
  revalidatePath("/");
  // Slug changes get a 308 redirect and search engines are pinged (see content-sync.ts).
  after(() => syncContentIndex().then(() => undefined));
}
