import "server-only";
import type { Batch, Certificate, CertificateEvaluation, CertificateRequest, Course, Database, EvaluatorSlot, PublicUser, Settings, User } from "@/lib/types";
import { getDb } from "@/lib/db/store";
import { hasRole, isModerator, toPublicUser } from "@/lib/auth/session";
import { getLessonHref } from "@/lib/data/courses";
import { toDateKey } from "@/lib/utils";
import {
  BOOKING_WINDOW_DAYS,
  EVALUATION_SLOT_MINUTES,
  addDaysToKey,
  clockToMinutes,
  isValidTimeZone,
  minutesToClock,
  timeZoneLabel,
  weekdayName,
  weekdayOfDateKey,
  zonedToUtcIso,
} from "@/components/certificates/time";

/**
 * Read models for certificates, the certified-members directory, evaluator
 * availability, evaluation bookings and the course certification page.
 */

/* ------------------------------------------------------------------ */
/* Time & roles                                                        */
/* ------------------------------------------------------------------ */

/**
 * Evaluator slots are wall-clock times in the platform time zone, which is
 * the server's zone (set TZ to change it).
 */
export function platformTimeZone(): string {
  const tz = process.env.TZ && isValidTimeZone(process.env.TZ) ? process.env.TZ : Intl.DateTimeFormat().resolvedOptions().timeZone;
  return tz || "UTC";
}

/** Today's date key and the current minute of the day in the platform zone. */
export function platformNow(): { dateKey: string; minutes: number } {
  const now = new Date();
  return { dateKey: toDateKey(now), minutes: now.getHours() * 60 + now.getMinutes() };
}

/** Whether the user holds a role that can evaluate (Batch Evaluator, Moderator or Admin). */
export function isEvaluatorRole(user: Pick<User, "roles"> | null | undefined): boolean {
  return !!user && user.roles.some((r) => r === "batch_evaluator" || r === "moderator" || r === "admin");
}

/**
 * Profile "Slots" and "Schedule" tabs are visible when the viewer is an
 * evaluator or moderator AND the profile user holds one of those roles.
 */
export function canViewEvaluatorTabs(viewer: Pick<User, "roles"> | null | undefined, profileUser: Pick<User, "roles">): boolean {
  return hasRole(viewer, "batch_evaluator", "moderator") && isEvaluatorRole(profileUser);
}

/** Who may issue, bulk-issue and revoke certificates from the admin area. */
export function canIssueCertificates(user: Pick<User, "roles"> | null | undefined): boolean {
  return hasRole(user, "moderator", "batch_evaluator");
}

export interface PersonLite {
  id: string;
  name: string;
  username: string;
  email: string;
  avatarUrl?: string;
  headline?: string;
}

function person(u: User | PublicUser | undefined | null): PersonLite | null {
  if (!u) return null;
  return { id: u.id, name: u.name, username: u.username, email: u.email, avatarUrl: u.avatarUrl, headline: u.headline };
}

const deletedPerson = (id: string): PersonLite => ({ id, name: "Deleted user", username: "", email: "" });

function isExpired(c: Pick<Certificate, "expiryDate">, today: string): boolean {
  return !!c.expiryDate && c.expiryDate < today;
}

/* ------------------------------------------------------------------ */
/* Admin certificate list                                              */
/* ------------------------------------------------------------------ */

export interface CertificateRow {
  id: string;
  code: string;
  user: PersonLite;
  courseId: string | null;
  courseTitle: string | null;
  batchId: string | null;
  batchTitle: string | null;
  evaluatorName: string | null;
  issueDate: string;
  expiryDate: string | null;
  published: boolean;
  expired: boolean;
}

export type CertificateStatusFilter = "published" | "unpublished" | "expired" | "";

export async function listCertificates(filter: { search?: string; courseId?: string; batchId?: string; status?: CertificateStatusFilter } = {}): Promise<CertificateRow[]> {
  const db = await getDb();
  const today = toDateKey();
  const users = new Map(db.users.map((u) => [u.id, u]));
  const courses = new Map(db.courses.map((c) => [c.id, c]));
  const batches = new Map(db.batches.map((b) => [b.id, b]));
  const search = filter.search?.trim().toLowerCase();
  return db.certificates
    .filter((c) => {
      if (filter.courseId && c.courseId !== filter.courseId) return false;
      if (filter.batchId && c.batchId !== filter.batchId) return false;
      if (filter.status === "published" && !c.published) return false;
      if (filter.status === "unpublished" && c.published) return false;
      if (filter.status === "expired" && !isExpired(c, today)) return false;
      if (search) {
        const u = users.get(c.userId);
        const hay = `${u?.name ?? ""} ${u?.email ?? ""} ${c.code} ${c.courseId ? (courses.get(c.courseId)?.title ?? "") : ""} ${c.batchId ? (batches.get(c.batchId)?.title ?? "") : ""}`.toLowerCase();
        if (!hay.includes(search)) return false;
      }
      return true;
    })
    .sort((a, b) => b.issueDate.localeCompare(a.issueDate) || a.code.localeCompare(b.code))
    .map((c) => ({
      id: c.id,
      code: c.code,
      user: person(users.get(c.userId)) ?? deletedPerson(c.userId),
      courseId: c.courseId ?? null,
      courseTitle: c.courseId ? (courses.get(c.courseId)?.title ?? "Deleted course") : null,
      batchId: c.batchId ?? null,
      batchTitle: c.batchId ? (batches.get(c.batchId)?.title ?? "Deleted batch") : null,
      evaluatorName: c.evaluatorId ? (users.get(c.evaluatorId)?.name ?? null) : null,
      issueDate: c.issueDate,
      expiryDate: c.expiryDate ?? null,
      published: c.published,
      expired: isExpired(c, today),
    }));
}

export interface CertificateFormOptions {
  learners: { value: string; label: string }[];
  courses: { value: string; label: string }[];
  batches: { value: string; label: string; certification: boolean }[];
  evaluators: { value: string; label: string }[];
}

export async function getCertificateFormOptions(): Promise<CertificateFormOptions> {
  const db = await getDb();
  const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name);
  return {
    learners: db.users
      .filter((u) => u.enabled)
      .sort(byName)
      .map((u) => ({ value: u.id, label: `${u.name} (${u.email})` })),
    courses: [...db.courses].sort((a, b) => a.title.localeCompare(b.title)).map((c) => ({ value: c.id, label: c.title })),
    batches: [...db.batches]
      .sort((a, b) => a.title.localeCompare(b.title))
      .map((b) => ({ value: b.id, label: b.certification ? b.title : `${b.title} (certification off)`, certification: b.certification })),
    evaluators: db.users
      .filter((u) => u.enabled && isEvaluatorRole(u))
      .sort(byName)
      .map((u) => ({ value: u.id, label: u.name })),
  };
}

/* ------------------------------------------------------------------ */
/* Public certificate                                                  */
/* ------------------------------------------------------------------ */

export interface CertificateDetail {
  certificate: Certificate;
  learner: PublicUser | null;
  course: Pick<Course, "id" | "slug" | "title"> | null;
  batch: Pick<Batch, "id" | "slug" | "title"> | null;
  evaluator: PublicUser | null;
  instructors: PublicUser[];
  brand: Settings["brand"];
  expired: boolean;
}

export async function getCertificateByCode(code: string): Promise<CertificateDetail | null> {
  const db = await getDb();
  const normalized = code.trim().toUpperCase();
  const certificate = db.certificates.find((c) => c.code.toUpperCase() === normalized);
  if (!certificate) return null;
  const learner = db.users.find((u) => u.id === certificate.userId);
  const course = certificate.courseId ? db.courses.find((c) => c.id === certificate.courseId) : undefined;
  const batch = certificate.batchId ? db.batches.find((b) => b.id === certificate.batchId) : undefined;
  const evaluator = certificate.evaluatorId ? db.users.find((u) => u.id === certificate.evaluatorId) : undefined;
  const instructorIds = course?.instructorIds ?? batch?.instructorIds ?? [];
  const instructors = instructorIds
    .map((id) => db.users.find((u) => u.id === id))
    .filter((u): u is User => !!u)
    .map(toPublicUser);
  return {
    certificate,
    learner: learner ? toPublicUser(learner) : null,
    course: course ? { id: course.id, slug: course.slug, title: course.title } : null,
    batch: batch ? { id: batch.id, slug: batch.slug, title: batch.title } : null,
    evaluator: evaluator ? toPublicUser(evaluator) : null,
    instructors,
    brand: db.settings.brand,
    expired: isExpired(certificate, toDateKey()),
  };
}

/* ------------------------------------------------------------------ */
/* Certified members directory                                         */
/* ------------------------------------------------------------------ */

export interface CertifiedMember {
  user: PersonLite & { createdAt: string };
  certificateCount: number;
  latestIssueDate: string;
  titles: string[];
}

function certificateTitle(db: Database, c: Certificate): string | null {
  if (c.courseId) return db.courses.find((x) => x.id === c.courseId)?.title ?? null;
  if (c.batchId) return db.batches.find((x) => x.id === c.batchId)?.title ?? null;
  return null;
}

export async function getCertifiedMembers(filter: { name?: string; category?: string } = {}): Promise<CertifiedMember[]> {
  const db = await getDb();
  const name = filter.name?.trim().toLowerCase();
  const category = filter.category?.trim().toLowerCase();
  const groups = new Map<string, { certs: Certificate[]; titles: Set<string> }>();
  for (const c of db.certificates) {
    if (!c.published) continue;
    const title = certificateTitle(db, c);
    const entry = groups.get(c.userId) ?? { certs: [], titles: new Set<string>() };
    entry.certs.push(c);
    if (title) entry.titles.add(title);
    groups.set(c.userId, entry);
  }
  const out: CertifiedMember[] = [];
  for (const [userId, entry] of groups) {
    const user = db.users.find((u) => u.id === userId);
    if (!user || !user.enabled) continue;
    if (name && !user.name.toLowerCase().includes(name)) continue;
    const titles = Array.from(entry.titles).sort((a, b) => a.localeCompare(b));
    if (category && !titles.some((t) => t.toLowerCase().includes(category))) continue;
    const latest = entry.certs.map((c) => c.issueDate).sort().at(-1) ?? "";
    out.push({ user: { ...person(user)!, createdAt: user.createdAt }, certificateCount: entry.certs.length, latestIssueDate: latest, titles });
  }
  return out.sort((a, b) => b.latestIssueDate.localeCompare(a.latestIssueDate) || a.user.name.localeCompare(b.user.name));
}

/** Distinct course/batch titles of published certificates (directory category filter). */
export async function getCertificationCategories(): Promise<string[]> {
  const db = await getDb();
  const titles = new Set<string>();
  for (const c of db.certificates) {
    if (!c.published) continue;
    const t = certificateTitle(db, c);
    if (t) titles.add(t);
  }
  return Array.from(titles).sort((a, b) => a.localeCompare(b));
}

/* ------------------------------------------------------------------ */
/* Evaluator availability                                              */
/* ------------------------------------------------------------------ */

export async function getEvaluatorSlots(evaluatorId: string): Promise<EvaluatorSlot[]> {
  const db = await getDb();
  const order = (day: number) => (day === 0 ? 7 : day);
  return db.evaluatorSlots
    .filter((s) => s.evaluatorId === evaluatorId)
    .sort((a, b) => order(a.day) - order(b.day) || a.startTime.localeCompare(b.startTime));
}

export interface BookableSlot {
  date: string;
  startTime: string;
  endTime: string;
  /** Absolute start instant (for local-time hints in the browser). */
  startsAt: string;
}

export interface AvailableDay {
  date: string;
  weekday: string;
  slots: BookableSlot[];
}

/**
 * 30-minute bookable slots for an evaluator over the next `days` days,
 * built from their weekly availability, skipping slots that already started
 * today and slots booked by any non-cancelled request.
 */
export async function getAvailableSlots(evaluatorId: string, opts: { days?: number; maxDate?: string | null } = {}): Promise<AvailableDay[]> {
  const db = await getDb();
  const tz = platformTimeZone();
  const days = opts.days ?? BOOKING_WINDOW_DAYS;
  const { dateKey: today, minutes: nowMinutes } = platformNow();
  const weekly = db.evaluatorSlots.filter((s) => s.evaluatorId === evaluatorId);
  if (!weekly.length) return [];
  const booked = new Set(
    db.certificateRequests.filter((r) => r.evaluatorId === evaluatorId && r.status !== "cancelled").map((r) => `${r.date}|${r.startTime}`),
  );
  const out: AvailableDay[] = [];
  for (let i = 0; i < days; i++) {
    const date = addDaysToKey(today, i);
    if (opts.maxDate && date > opts.maxDate) break;
    const weekday = weekdayOfDateKey(date);
    const windows = weekly.filter((s) => s.day === weekday).sort((a, b) => a.startTime.localeCompare(b.startTime));
    const seen = new Set<string>();
    const slots: BookableSlot[] = [];
    for (const w of windows) {
      const start = clockToMinutes(w.startTime);
      const end = clockToMinutes(w.endTime);
      for (let t = start; t + EVALUATION_SLOT_MINUTES <= end; t += EVALUATION_SLOT_MINUTES) {
        const startTime = minutesToClock(t);
        if (seen.has(startTime)) continue;
        seen.add(startTime);
        if (i === 0 && t <= nowMinutes) continue;
        if (booked.has(`${date}|${startTime}`)) continue;
        slots.push({ date, startTime, endTime: minutesToClock(t + EVALUATION_SLOT_MINUTES), startsAt: zonedToUtcIso(date, startTime, tz) });
      }
    }
    slots.sort((a, b) => a.startTime.localeCompare(b.startTime));
    if (slots.length) out.push({ date, weekday: weekdayName(date), slots });
  }
  return out;
}

/**
 * Evaluators a learner can book for a course: the course's assigned
 * evaluator when set, otherwise every evaluator who published weekly slots.
 */
export async function getCourseEvaluators(course: Pick<Course, "evaluatorId">): Promise<PersonLite[]> {
  const db = await getDb();
  if (course.evaluatorId) {
    const u = db.users.find((x) => x.id === course.evaluatorId && x.enabled);
    return u ? [person(u)!] : [];
  }
  const withSlots = new Set(db.evaluatorSlots.map((s) => s.evaluatorId));
  return db.users
    .filter((u) => u.enabled && isEvaluatorRole(u) && withSlots.has(u.id))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((u) => person(u)!);
}

/* ------------------------------------------------------------------ */
/* Evaluation bookings                                                 */
/* ------------------------------------------------------------------ */

export interface EvaluationCard {
  id: string;
  courseId: string;
  courseTitle: string;
  courseSlug: string | null;
  batchId: string | null;
  batchTitle: string | null;
  batchSlug: string | null;
  date: string;
  startTime: string;
  endTime: string;
  timezone: string;
  timezoneLabel: string;
  startsAt: string;
  endsAt: string;
  learner: PersonLite;
  evaluator: PersonLite;
  meetingLink: string | null;
  status: CertificateRequest["status"];
  /** Learners may cancel only before the evaluation starts. */
  canCancel: boolean;
  /** Upcoming but already over (waiting for the evaluator's result). */
  awaitingResult: boolean;
}

function requestTimeZone(r: CertificateRequest): string {
  return r.timezone && isValidTimeZone(r.timezone) ? r.timezone : platformTimeZone();
}

function toEvaluationCard(db: Database, r: CertificateRequest, now: number): EvaluationCard {
  const tz = requestTimeZone(r);
  const course = db.courses.find((c) => c.id === r.courseId);
  const batch = r.batchId ? db.batches.find((b) => b.id === r.batchId) : undefined;
  const startsAt = zonedToUtcIso(r.date, r.startTime, tz);
  const endsAt = zonedToUtcIso(r.date, r.endTime || r.startTime, tz);
  const startMs = new Date(startsAt).getTime();
  const endMs = new Date(endsAt).getTime();
  return {
    id: r.id,
    courseId: r.courseId,
    courseTitle: course?.title ?? "Deleted course",
    courseSlug: course?.slug ?? null,
    batchId: batch?.id ?? null,
    batchTitle: batch?.title ?? null,
    batchSlug: batch?.slug ?? null,
    date: r.date,
    startTime: r.startTime,
    endTime: r.endTime,
    timezone: tz,
    timezoneLabel: timeZoneLabel(tz, new Date(startsAt)),
    startsAt,
    endsAt,
    learner: person(db.users.find((u) => u.id === r.userId)) ?? deletedPerson(r.userId),
    evaluator: person(db.users.find((u) => u.id === r.evaluatorId)) ?? deletedPerson(r.evaluatorId),
    meetingLink: r.meetingLink ?? null,
    status: r.status,
    canCancel: r.status === "upcoming" && startMs > now,
    awaitingResult: r.status === "upcoming" && endMs <= now,
  };
}

/** A learner's booked evaluations that have not happened yet. */
export async function getUpcomingEvaluationsForUser(userId: string, opts: { courseIds?: string[] } = {}): Promise<EvaluationCard[]> {
  const db = await getDb();
  const now = Date.now();
  return db.certificateRequests
    .filter((r) => r.userId === userId && r.status === "upcoming" && (!opts.courseIds || opts.courseIds.includes(r.courseId)))
    .map((r) => toEvaluationCard(db, r, now))
    .filter((c) => new Date(c.endsAt).getTime() > now)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

export interface ScheduleEvent extends EvaluationCard {
  evaluation: { id: string; rating: number; status: CertificateEvaluation["status"]; summary: string | null } | null;
  certificate: { id: string; code: string; published: boolean; issueDate: string; expiryDate: string | null } | null;
}

/** Every non-cancelled booking assigned to an evaluator, with evaluation results and certificates. */
export async function getEvaluatorSchedule(evaluatorId: string): Promise<ScheduleEvent[]> {
  const db = await getDb();
  const now = Date.now();
  return db.certificateRequests
    .filter((r) => r.evaluatorId === evaluatorId && r.status !== "cancelled")
    .map((r): ScheduleEvent => {
      const card = toEvaluationCard(db, r, now);
      const evaluation = db.certificateEvaluations.find((e) => e.userId === r.userId && e.courseId === r.courseId);
      const certificate = db.certificates.find((c) => c.userId === r.userId && c.courseId === r.courseId);
      return {
        ...card,
        evaluation: evaluation ? { id: evaluation.id, rating: evaluation.rating, status: evaluation.status, summary: evaluation.summary ?? null } : null,
        certificate: certificate
          ? { id: certificate.id, code: certificate.code, published: certificate.published, issueDate: certificate.issueDate, expiryDate: certificate.expiryDate ?? null }
          : null,
      };
    })
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

/* ------------------------------------------------------------------ */
/* Course certification page                                           */
/* ------------------------------------------------------------------ */

export interface EvaluatorAvailability {
  evaluator: PersonLite;
  days: AvailableDay[];
}

export interface CertificationState {
  course: Pick<Course, "id" | "slug" | "title" | "paidCertificate" | "enableCertification" | "certificatePrice" | "currency">;
  enrolled: boolean;
  progress: number;
  purchased: boolean;
  certificate: { code: string; issueDate: string; expiryDate: string | null; published: boolean } | null;
  /** The learner may book an evaluation (paid certificate purchased, or a certification batch). */
  canSchedule: boolean;
  /** Paid certificate not bought yet. */
  needsPurchase: boolean;
  /** Free completion certificate course. */
  completion: boolean;
  batch: { id: string; title: string; slug: string; evaluationEndDate: string | null } | null;
  deadline: { date: string; passed: boolean } | null;
  availability: EvaluatorAvailability[];
  upcoming: EvaluationCard[];
  history: { id: string; date: string; status: CertificateEvaluation["status"]; rating: number; summary: string | null; evaluatorName: string }[];
  nextLessonHref: string | null;
  timeZone: string;
  timeZoneLabel: string;
}

export async function getCertificationState(user: User, course: Course): Promise<CertificationState> {
  const db = await getDb();
  const enrollment = db.enrollments.find((e) => e.userId === user.id && e.courseId === course.id) ?? null;
  const certificate = db.certificates.find((c) => c.userId === user.id && c.courseId === course.id) ?? null;
  const today = toDateKey();

  // A certification-enabled batch the learner belongs to that includes this course.
  const memberBatchIds = new Set(db.batchEnrollments.filter((b) => b.userId === user.id).map((b) => b.batchId));
  const candidateBatches = db.batches.filter((b) => b.certification && memberBatchIds.has(b.id) && b.courseIds.includes(course.id));
  const batchRow = candidateBatches.find((b) => b.id === enrollment?.batchId) ?? candidateBatches[0] ?? null;

  const purchased = !!enrollment?.purchasedCertificate;
  const canSchedule = !!enrollment && !certificate && ((course.paidCertificate && purchased) || !!batchRow);
  const deadlineDate = batchRow?.evaluationEndDate ?? null;
  const deadline = deadlineDate ? { date: deadlineDate, passed: deadlineDate < today } : null;

  let availability: EvaluatorAvailability[] = [];
  if (canSchedule && !deadline?.passed) {
    const evaluators = await getCourseEvaluators(course);
    availability = await Promise.all(evaluators.map(async (evaluator) => ({ evaluator, days: await getAvailableSlots(evaluator.id, { maxDate: deadlineDate }) })));
  }

  const upcoming = await getUpcomingEvaluationsForUser(user.id, { courseIds: [course.id] });
  const history = db.certificateEvaluations
    .filter((e) => e.userId === user.id && e.courseId === course.id)
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((e) => ({
      id: e.id,
      date: e.date,
      status: e.status,
      rating: e.rating,
      summary: e.summary ?? null,
      evaluatorName: db.users.find((u) => u.id === e.evaluatorId)?.name ?? "Evaluator",
    }));

  let nextLessonHref: string | null = null;
  if (enrollment) {
    const lessons = db.lessons.filter((l) => l.courseId === course.id);
    const done = new Set(db.progress.filter((p) => p.userId === user.id && p.courseId === course.id && p.status === "complete").map((p) => p.lessonId));
    const chapters = db.chapters.filter((c) => c.courseId === course.id).sort((a, b) => a.order - b.order);
    const ordered = chapters.flatMap((ch) => lessons.filter((l) => l.chapterId === ch.id).sort((a, b) => a.order - b.order));
    const next = ordered.find((l) => !done.has(l.id)) ?? ordered[0];
    nextLessonHref = next ? await getLessonHref(next.id) : null;
  }

  const tz = platformTimeZone();
  return {
    course: {
      id: course.id,
      slug: course.slug,
      title: course.title,
      paidCertificate: course.paidCertificate,
      enableCertification: course.enableCertification,
      certificatePrice: course.certificatePrice,
      currency: course.currency,
    },
    enrolled: !!enrollment,
    progress: enrollment?.progress ?? 0,
    purchased,
    certificate: certificate
      ? { code: certificate.code, issueDate: certificate.issueDate, expiryDate: certificate.expiryDate ?? null, published: certificate.published }
      : null,
    canSchedule,
    needsPurchase: course.paidCertificate && !purchased && !batchRow,
    completion: course.enableCertification && !course.paidCertificate,
    batch: batchRow ? { id: batchRow.id, title: batchRow.title, slug: batchRow.slug, evaluationEndDate: batchRow.evaluationEndDate ?? null } : null,
    deadline,
    availability,
    upcoming,
    history,
    nextLessonHref,
    timeZone: tz,
    timeZoneLabel: timeZoneLabel(tz),
  };
}

/* ------------------------------------------------------------------ */
/* Bulk issue roster                                                   */
/* ------------------------------------------------------------------ */

export interface BulkRosterStudent {
  user: PersonLite;
  enrolledAt: string;
  /** courseId → progress 0-100 */
  courseProgress: Record<string, number>;
  averageProgress: number;
  certifiedForBatch: boolean;
  certifiedCourseIds: string[];
}

export interface BulkRoster {
  batch: { id: string; title: string; slug: string; certification: boolean };
  courses: { id: string; title: string }[];
  students: BulkRosterStudent[];
}

export async function getBulkIssueRoster(batchId: string): Promise<BulkRoster | null> {
  const db = await getDb();
  const batch = db.batches.find((b) => b.id === batchId);
  if (!batch) return null;
  const courses = batch.courseIds
    .map((id) => db.courses.find((c) => c.id === id))
    .filter((c): c is Course => !!c)
    .map((c) => ({ id: c.id, title: c.title }));
  const students = db.batchEnrollments
    .filter((e) => e.batchId === batch.id)
    .map((e): BulkRosterStudent | null => {
      const user = db.users.find((u) => u.id === e.userId);
      if (!user) return null;
      const courseProgress: Record<string, number> = {};
      for (const c of courses) courseProgress[c.id] = db.enrollments.find((x) => x.userId === user.id && x.courseId === c.id)?.progress ?? 0;
      const values = Object.values(courseProgress);
      const certs = db.certificates.filter((c) => c.userId === user.id);
      return {
        user: person(user)!,
        enrolledAt: e.enrolledAt,
        courseProgress,
        averageProgress: values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : 0,
        certifiedForBatch: certs.some((c) => c.batchId === batch.id && !c.courseId),
        certifiedCourseIds: certs.filter((c) => c.courseId).map((c) => c.courseId!),
      };
    })
    .filter((s): s is BulkRosterStudent => !!s)
    .sort((a, b) => a.user.name.localeCompare(b.user.name));
  return { batch: { id: batch.id, title: batch.title, slug: batch.slug, certification: batch.certification }, courses, students };
}

export async function listBatchesForBulkIssue(): Promise<{ id: string; title: string; slug: string; certification: boolean; studentCount: number; startDate: string; endDate: string }[]> {
  const db = await getDb();
  return db.batches
    .map((b) => ({
      id: b.id,
      title: b.title,
      slug: b.slug,
      certification: b.certification,
      studentCount: db.batchEnrollments.filter((e) => e.batchId === b.id).length,
      startDate: b.startDate,
      endDate: b.endDate,
    }))
    .sort((a, b) => Number(b.certification) - Number(a.certification) || b.startDate.localeCompare(a.startDate));
}

/** Moderators can edit anyone's availability; everyone else only their own. */
export function canEditAvailability(viewer: Pick<User, "id" | "roles">, evaluatorId: string): boolean {
  return viewer.id === evaluatorId || isModerator(viewer);
}
