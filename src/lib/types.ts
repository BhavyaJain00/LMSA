/**
 * Core domain types for the LMS.
 *
 * The model mirrors Frappe LMS (courses → chapters → lessons, quizzes with a
 * question bank, batches/cohorts with live classes, assignments, programming
 * exercises, programs, certificates, badges, jobs, payments, notifications)
 * re-expressed as plain TypeScript for a JSON-backed store.
 *
 * Keep this file free of runtime imports so it can be used on both server
 * and client.
 */

/* ------------------------------------------------------------------ */
/* Users & auth                                                        */
/* ------------------------------------------------------------------ */

/**
 * Roles map to Frappe LMS roles:
 *  - student          → "LMS Student"
 *  - course_creator   → "Course Creator"
 *  - moderator        → "Moderator"
 *  - batch_evaluator  → "Batch Evaluator"
 *  - admin            → "System Manager"
 */
export type Role = "student" | "course_creator" | "moderator" | "batch_evaluator" | "admin";

export interface SocialLinks {
  website?: string;
  linkedin?: string;
  github?: string;
  x?: string;
  youtube?: string;
}

export interface EducationDetail {
  id: string;
  institution: string;
  degree: string;
  fieldOfStudy?: string;
  startYear?: number;
  endYear?: number;
}

export interface WorkExperience {
  id: string;
  company: string;
  title: string;
  location?: string;
  startDate?: string;
  endDate?: string;
  current?: boolean;
  description?: string;
}

export interface User {
  id: string;
  /** Unique handle used in profile URLs: /user/:username */
  username: string;
  name: string;
  email: string;
  passwordHash: string;
  roles: Role[];
  avatarUrl?: string;
  coverImageUrl?: string;
  headline?: string;
  /** Markdown */
  bio?: string;
  location?: string;
  socials?: SocialLinks;
  education?: EducationDetail[];
  workExperience?: WorkExperience[];
  skills?: string[];
  /** Profile status shown as a badge on the avatar: looking for work, or hiring talent. */
  openTo?: "work" | "hiring";
  /** Whether the user finished the onboarding persona form. */
  personaCaptured?: boolean;
  persona?: {
    role?: string;
    industry?: string;
    goals?: string[];
    referrer?: string;
  };
  enabled: boolean;
  lastActiveAt?: string;
  createdAt: string; // ISO date

  /* ----- round 2: account security, email, calendar ----- */
  /** Set once the user confirmed their email address. */
  emailVerifiedAt?: string;
  /** True for self-registered accounts that must verify their email (seed/admin-created accounts leave it unset). */
  emailVerificationRequired?: boolean;
  twoFactorEnabled?: boolean;
  /** TOTP secret, encrypted at rest (AES-256-GCM, key derived from APP_SECRET). */
  twoFactorSecretEnc?: string;
  /** Last accepted TOTP time step (replay protection). */
  twoFactorLastStep?: number;
  /** SHA-256 hashes of unused recovery codes. */
  recoveryCodeHashes?: string[];
  failedLoginCount?: number;
  lockedUntil?: string;
  emailPreferences?: EmailPreferences;
  /** Secret token for the personal calendar (ICS) feed. */
  calendarToken?: string;
}

/** Which categories of email a user wants to receive (round 2). */
export interface EmailPreferences {
  enrollment: boolean;
  announcements: boolean;
  liveClasses: boolean;
  grading: boolean;
  certificates: boolean;
  discussions: boolean;
  reminders: boolean;
  payments: boolean;
}

/** Public-safe projection of a user (never send passwordHash to the client). */
export type PublicUser = Omit<User, "passwordHash">;

export interface Session {
  id: string;
  /** SHA-256 hash of the raw token stored in the cookie. */
  tokenHash: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
  userAgent?: string;
}

/* ------------------------------------------------------------------ */
/* Catalog                                                             */
/* ------------------------------------------------------------------ */

export interface Category {
  id: string;
  name: string;
  slug: string;
  /* ----- round 3: category landing pages ----- */
  /** Markdown introduction shown at the top of the category page. */
  intro?: string;
  seoTitle?: string;
  seoDescription?: string;
}

export type CourseStatus = "in_progress" | "under_review" | "approved";

export type CardGradient =
  | "red"
  | "blue"
  | "green"
  | "amber"
  | "cyan"
  | "orange"
  | "pink"
  | "purple"
  | "teal"
  | "violet"
  | "yellow";

export interface Course {
  id: string;
  slug: string;
  title: string;
  /** One or two sentences shown on cards (Frappe: short_introduction). */
  shortIntroduction: string;
  /** Markdown (Frappe: description). */
  description: string;
  /** Cover image. */
  imageUrl?: string;
  /** Self-hosted promo video URL shown on the course page (Frappe: video_link). */
  videoUrl?: string;
  /** Gradient used on the card when there is no image. */
  cardGradient: CardGradient;
  instructorIds: string[];
  /** Optional evaluator for certificate evaluations. */
  evaluatorId?: string;
  categoryId?: string;
  tags: string[];
  /** Price in the smallest currency unit (cents). 0 = free. */
  price: number;
  currency: string;
  paidCourse: boolean;
  /** Whether learners can pay for a certificate after finishing. */
  paidCertificate: boolean;
  certificatePrice: number;
  /** Auto-issue a certificate on completion. */
  enableCertification: boolean;
  published: boolean;
  publishedOn?: string;
  /** Show as "Upcoming" and block enrollment. */
  upcoming: boolean;
  featured: boolean;
  /** Learners cannot enroll themselves — only via batches. */
  disableSelfLearning: boolean;
  /** Lessons unlock strictly in order. */
  enforceLessonCompletion: boolean;
  /** Review workflow for creators → moderators. */
  status: CourseStatus;
  relatedCourseIds: string[];
  outcomes: string[];
  requirements: string[];
  /** SEO summary for search results (max 160 characters). */
  metaDescription?: string;
  /** Comma-separated SEO keywords. */
  metaKeywords?: string;
  /** Round 2: courses that must be completed before enrolling. */
  prerequisiteCourseIds?: string[];
  /* ----- round 3: sales page, SEO, AI tutor ----- */
  /** Long-form landing page content rendered on the public course page. */
  salesPage?: CourseSalesPage;
  /** Overrides the `<title>` of the course page (falls back to the course title). */
  seoTitle?: string;
  /** Social share image (falls back to `imageUrl`, then a generated card). */
  ogImageUrl?: string;
  /** Lets enrolled learners chat with the AI tutor about this course (requires `settings.ai.enabled`). */
  aiTutorEnabled?: boolean;
  /* ----- round 3 wave B: installments, multi-currency, scheduled publish ----- */
  /** Pay in parts (requires `settings.growth.installmentsEnabled`). */
  installments?: CourseInstallmentPlan;
  /** Fixed prices in other currencies (smallest unit), used when `settings.growth.multiCurrency` is on. */
  prices?: CurrencyPrice[];
  /** ISO date-time: the course becomes visible in the catalog from then on (scheduled publish). */
  publishAt?: string;
  createdById: string;
  createdAt: string;
  updatedAt: string;
}

/** Round 3 wave B: a fixed price in a specific currency (amount in the smallest currency unit). */
export interface CurrencyPrice {
  /** ISO 4217 code, e.g. "EUR". */
  currency: string;
  amount: number;
}

/** Round 3 wave B: split a course price into equal parts paid every `intervalDays`. */
export interface CourseInstallmentPlan {
  /** Number of payments (2 or more). */
  count: number;
  intervalDays: number;
  /** Extra charged on top of the price when paying in parts, 0-100. */
  surchargePercent: number;
}

/** Round 3: one block of a course sales page. */
export interface SalesSection {
  id: string;
  type: "text" | "features" | "curriculum" | "instructor" | "testimonials" | "faq" | "pricing" | "video" | "cta";
  title?: string;
  /** Markdown */
  body?: string;
  /** Bullet/feature items (used by "features", optional elsewhere). */
  items?: { title: string; body?: string; icon?: string }[];
}

/** Round 3: a learner quote on a course sales page. */
export interface SalesTestimonial {
  name: string;
  role?: string;
  avatarUrl?: string;
  quote: string;
  /** 1-5 */
  rating?: number;
}

/** Round 3: question/answer pair (sales pages, blog posts; rendered as FAQPage JSON-LD). */
export interface FaqItem {
  question: string;
  /** Markdown */
  answer: string;
}

/** Round 3: course sales page (hero, sections, FAQ, testimonials, guarantee, countdown). */
export interface CourseSalesPage {
  heroHeadline?: string;
  heroSubheadline?: string;
  sections: SalesSection[];
  faq: FaqItem[];
  testimonials: SalesTestimonial[];
  /** Markdown, e.g. "30-day money-back guarantee". */
  guarantee?: string;
  /** ISO date; shows an offer countdown until then. */
  countdownEndsAt?: string;
  /** Show enrollment/rating/lesson stats in the hero. */
  showStats: boolean;
}

export interface Chapter {
  id: string;
  courseId: string;
  title: string;
  description?: string;
  order: number;
  /** Round 2 drip: unlocks N days after enrollment (or batch start). */
  dripDays?: number;
  /** Round 2 drip: unlocks on this date (YYYY-MM-DD, 00:00 UTC). */
  availableFrom?: string;
}

/* ------------------------------------------------------------------ */
/* Lessons & content blocks                                            */
/* ------------------------------------------------------------------ */

export interface VideoChapterMarker {
  /** Seconds from the start of the video. */
  time: number;
  title: string;
}

export interface VideoQuizMarker {
  /** Seconds from the start; playback pauses and the quiz opens. */
  time: number;
  quizId: string;
}

/** A rendition of a lesson video (round 2 quality selector). */
export interface VideoSource {
  src: string;
  /** e.g. "1080p", "720p", "Data saver" */
  label: string;
  height?: number;
}

export type LessonBlock =
  | {
      id: string;
      type: "markdown";
      /** Markdown text. */
      content: string;
    }
  | {
      id: string;
      type: "video";
      /** Self-hosted video URL (mp4/webm/ogg). Never a YouTube/Vimeo embed. */
      src: string;
      posterUrl?: string;
      captionsUrl?: string;
      /** Duration in seconds, if known. */
      duration?: number;
      chapters?: VideoChapterMarker[];
      quizMarkers?: VideoQuizMarker[];
      title?: string;
      /** Round 2: alternative renditions for the quality selector (the main `src` is the default). */
      sources?: VideoSource[];
      /* ----- round 3: adaptive streaming, transcripts, object storage ----- */
      /** HLS master playlist URL (adaptive bitrate); `src` stays the progressive fallback. */
      hlsUrl?: string;
      /** State of the HLS conversion of an uploaded video. */
      transcode?: VideoTranscodeState;
      /** Id of the `Transcript` used for the transcript panel, search and the AI tutor. */
      transcriptId?: string;
      /** Storage-driver key of the original upload (local path or S3 object key). */
      storageKey?: string;
    }
  | {
      id: string;
      type: "audio";
      src: string;
      title?: string;
      duration?: number;
    }
  | {
      id: string;
      type: "pdf";
      src: string;
      title?: string;
    }
  | {
      id: string;
      type: "image";
      src: string;
      alt?: string;
      caption?: string;
    }
  | {
      id: string;
      type: "file";
      src: string;
      title: string;
      sizeBytes?: number;
    }
  | {
      id: string;
      type: "code";
      language: string;
      code: string;
    }
  | {
      id: string;
      type: "embed";
      /** Any iframe-able URL (not used for video). */
      src: string;
      title?: string;
      height?: number;
    }
  | {
      id: string;
      type: "quiz";
      quizId: string;
    }
  | {
      id: string;
      type: "assignment";
      assignmentId: string;
    }
  | {
      id: string;
      type: "exercise";
      exerciseId: string;
    }
  | {
      id: string;
      type: "callout";
      tone: "info" | "success" | "warning" | "danger";
      content: string;
    };

export type LessonBlockType = LessonBlock["type"];

/** Round 3: HLS conversion state stored on a video block. */
export interface VideoTranscodeState {
  status: "pending" | "processing" | "ready" | "failed" | "unavailable";
  /** 0-100 */
  progress?: number;
  error?: string;
  /** Renditions present in the master playlist. */
  renditions?: { height: number; bandwidth: number }[];
  updatedAt: string;
}

export interface Lesson {
  id: string;
  courseId: string;
  chapterId: string;
  slug: string;
  title: string;
  order: number;
  /** Ordered content blocks. */
  blocks: LessonBlock[];
  /** Markdown shown only to instructors/moderators (Frappe: instructor_notes). */
  instructorNotes?: string;
  /** Free preview lessons can be watched without enrolling. */
  includeInPreview: boolean;
  /** Estimated duration in seconds (sum of video durations + reading time). */
  durationSeconds: number;
  /** Round 2 drip: unlocks N days after enrollment (or batch start). */
  dripDays?: number;
  /** Round 2 drip: unlocks on this date (YYYY-MM-DD, 00:00 UTC). */
  availableFrom?: string;
  /** Round 3 wave B: ISO date-time the lesson becomes visible to learners (scheduled publish). */
  publishAt?: string;
  createdAt: string;
  updatedAt: string;
}

/* ------------------------------------------------------------------ */
/* Quizzes                                                           */
/* ------------------------------------------------------------------ */

export type QuestionType = "choices" | "user_input" | "open_ended";

export interface QuestionOption {
  id: string;
  text: string;
  isCorrect: boolean;
  explanation?: string;
}

/** Question bank entry (Frappe: LMS Question). Reusable across quizzes. */
export interface Question {
  id: string;
  /** Markdown */
  text: string;
  type: QuestionType;
  /** For "choices": allow selecting multiple correct answers. */
  multiple: boolean;
  /** Default marks; can be overridden per quiz. */
  marks: number;
  options: QuestionOption[];
  /** Accepted answers for "user_input" (case-insensitive match). */
  possibilities: string[];
  authorId: string;
  createdAt: string;
  updatedAt: string;
}

export interface QuizQuestionRef {
  questionId: string;
  marks: number;
}

export interface Quiz {
  id: string;
  title: string;
  /** Optional markdown instructions shown on the quiz intro card. */
  description?: string;
  courseId?: string;
  lessonId?: string;
  questions: QuizQuestionRef[];
  /** 0 = unlimited */
  maxAttempts: number;
  showAnswers: boolean;
  showSubmissionHistory: boolean;
  /** 0-100 */
  passingPercentage: number;
  totalMarks: number;
  shuffleQuestions: boolean;
  /** 0 = use all questions. */
  limitQuestionsTo: number;
  /** Timer in seconds. 0 = no limit. */
  durationSeconds: number;
  enableNegativeMarking: boolean;
  marksToCut: number;
  enableScheduling: boolean;
  scheduleStart?: string;
  scheduleEnd?: string;
  enableProctoring: boolean;
  maxViolations: number;
  authorId: string;
  createdAt: string;
  updatedAt: string;
}

export interface QuizResultRow {
  questionId: string;
  questionText: string;
  questionType: QuestionType;
  /** Selected option ids or typed answer(s). */
  answer: string[];
  isCorrect: boolean;
  /** Marks awarded (may be negative with negative marking). */
  marks: number;
  marksOutOf: number;
  /** Open-ended questions are graded manually. */
  graded: boolean;
}

export interface QuizSubmission {
  id: string;
  quizId: string;
  quizTitle: string;
  userId: string;
  courseId?: string;
  lessonId?: string;
  results: QuizResultRow[];
  score: number;
  scoreOutOf: number;
  /** 0-100 */
  percentage: number;
  passingPercentage: number;
  passed: boolean;
  violationCount: number;
  /** e.g. "Time limit exceeded", "Maximum violations reached" */
  submissionReason?: string;
  timeTakenSeconds: number;
  /** Set when an open-ended question is still awaiting grading. */
  pendingGrading: boolean;
  submittedAt: string;
}

export type ViolationType = "tab_switch" | "focus_loss" | "fullscreen_exit" | "copy_paste";

export interface QuizViolation {
  id: string;
  quizId: string;
  userId: string;
  submissionId?: string;
  eventType: ViolationType;
  severity: "warning" | "violation";
  timestamp: string;
}

/* ------------------------------------------------------------------ */
/* Assignments & programming exercises                                 */
/* ------------------------------------------------------------------ */

export type AssignmentType = "document" | "pdf" | "url" | "image" | "text";

export interface Assignment {
  id: string;
  title: string;
  /** Markdown */
  question: string;
  type: AssignmentType;
  showAnswer: boolean;
  /** Markdown model answer. */
  answer?: string;
  gradeAssignment: boolean;
  courseId?: string;
  enableScheduling: boolean;
  scheduleStart?: string;
  scheduleEnd?: string;
  /* ----- round 3 wave B: rubrics, peer review ----- */
  /** Rubric used to grade submissions. */
  rubricId?: string;
  peerReview?: PeerReviewSettings;
  authorId: string;
  createdAt: string;
  updatedAt: string;
}

/** Round 3 wave B: peer review configuration of an assignment. */
export interface PeerReviewSettings {
  enabled: boolean;
  /** How many peers review each submission. */
  reviewsPerSubmission: number;
  /** Days a reviewer has after being assigned. */
  dueDays: number;
  /** Hide reviewer and author names from each other. */
  anonymous: boolean;
}

export type AssignmentStatus = "pass" | "fail" | "not_graded" | "not_applicable";

export interface AssignmentSubmission {
  id: string;
  assignmentId: string;
  assignmentTitle: string;
  userId: string;
  courseId?: string;
  lessonId?: string;
  type: AssignmentType;
  attachmentUrl?: string;
  /** Text / URL answer. */
  answer?: string;
  status: AssignmentStatus;
  /** Evaluator feedback (markdown). */
  comments?: string;
  evaluatorId?: string;
  gradedAt?: string;
  /** Round 3 wave B: per-criterion scores when the assignment is graded with a rubric. */
  rubricScores?: RubricScore[];
  submittedAt: string;
  updatedAt: string;
}

export type ExerciseLanguage = "javascript" | "typescript" | "python" | "go" | "rust";

export interface TestCase {
  id: string;
  input: string;
  expectedOutput: string;
  hidden?: boolean;
}

export interface ProgrammingExercise {
  id: string;
  title: string;
  /** Markdown */
  problemStatement: string;
  language: ExerciseLanguage;
  starterCode?: string;
  testCases: TestCase[];
  courseId?: string;
  authorId: string;
  createdAt: string;
  updatedAt: string;
}

export interface TestCaseResult {
  testCaseId: string;
  input: string;
  expectedOutput: string;
  actualOutput: string;
  passed: boolean;
  error?: string;
}

export interface ExerciseSubmission {
  id: string;
  exerciseId: string;
  exerciseTitle: string;
  userId: string;
  courseId?: string;
  lessonId?: string;
  code: string;
  status: "passed" | "failed";
  testResults: TestCaseResult[];
  submittedAt: string;
}

/* ------------------------------------------------------------------ */
/* Enrollment & progress                                               */
/* ------------------------------------------------------------------ */

export type MemberType = "student" | "mentor" | "staff";

export interface Enrollment {
  id: string;
  userId: string;
  courseId: string;
  memberType: MemberType;
  enrolledAt: string;
  completedAt?: string;
  /** 0-100 (denormalized for fast listing). */
  progress: number;
  /** Last lesson the learner opened, for "continue where you left off". */
  currentLessonId?: string;
  paymentId?: string;
  purchasedCertificate: boolean;
  certificateId?: string;
  /** Set when the enrollment came through a batch. */
  batchId?: string;
}

export type ProgressStatus = "complete" | "partial" | "incomplete";

export interface LessonProgress {
  id: string;
  userId: string;
  courseId: string;
  chapterId: string;
  lessonId: string;
  status: ProgressStatus;
  /** Seconds the learner spent on the lesson page. */
  dwellSeconds: number;
  completedAt?: string;
  updatedAt: string;
}

/** Per-video watch tracking (Frappe: LMS Video Watch Duration). */
export interface VideoWatch {
  id: string;
  userId: string;
  courseId: string;
  lessonId: string;
  blockId: string;
  /** Video URL. */
  source: string;
  /** Seconds actually watched (approximate). */
  watchSeconds: number;
  /** Where playback should resume. */
  lastPositionSeconds: number;
  /** Highest position ever reached, used to prevent skipping. */
  maxPositionSeconds: number;
  durationSeconds: number;
  /** True once ≥ 95% watched. */
  completed: boolean;
  /** Round 2 retention analytics: 100 bins, each counting viewing passes over that 1% of the video. */
  bins?: number[];
  updatedAt: string;
}

export type NoteColor = "red" | "blue" | "green" | "yellow" | "purple";

export interface LessonNote {
  id: string;
  userId: string;
  courseId: string;
  lessonId: string;
  color: NoteColor;
  /** Text the learner highlighted in the lesson, if any. */
  highlightedText?: string;
  /** Video timestamp the note is attached to, if any. */
  timestampSeconds?: number;
  /** Markdown */
  note: string;
  createdAt: string;
  updatedAt: string;
}

export interface Review {
  id: string;
  userId: string;
  courseId: string;
  rating: 1 | 2 | 3 | 4 | 5;
  review: string;
  createdAt: string;
}

/* ------------------------------------------------------------------ */
/* Batches, live classes, programs                                     */
/* ------------------------------------------------------------------ */

export type BatchMedium = "online" | "offline";

export type AssessmentType = "quiz" | "assignment" | "exercise";

export interface BatchAssessment {
  id: string;
  type: AssessmentType;
  refId: string;
}

export type TimetableItemType = "course" | "lesson" | "live_class" | "quiz" | "assignment" | "exercise" | "custom";

export interface TimetableItem {
  id: string;
  type: TimetableItemType;
  refId?: string;
  title: string;
  /** YYYY-MM-DD */
  date: string;
  /** HH:mm */
  startTime?: string;
  endTime?: string;
  milestone: boolean;
  legendId?: string;
}

export interface TimetableLegend {
  id: string;
  label: string;
  color: string;
}

export interface Batch {
  id: string;
  slug: string;
  title: string;
  /** Short description for cards (Frappe: description). */
  description: string;
  /** Markdown (Frappe: batch_details). */
  details: string;
  imageUrl?: string;
  categoryId?: string;
  /** YYYY-MM-DD */
  startDate: string;
  endDate: string;
  /** HH:mm */
  startTime: string;
  endTime: string;
  timezone: string;
  medium: BatchMedium;
  /** 0 = unlimited */
  seatCount: number;
  paidBatch: boolean;
  amount: number;
  currency: string;
  published: boolean;
  allowSelfEnrollment: boolean;
  /** Allow enrolling after the batch has started. */
  allowFuture: boolean;
  showLiveClass: boolean;
  certification: boolean;
  evaluationEndDate?: string;
  instructorIds: string[];
  courseIds: string[];
  assessments: BatchAssessment[];
  timetable: TimetableItem[];
  timetableLegends: TimetableLegend[];
  conferencingProvider?: "zoom" | "google_meet" | "custom";
  createdById: string;
  createdAt: string;
  updatedAt: string;
}

export interface BatchEnrollment {
  id: string;
  batchId: string;
  userId: string;
  paymentId?: string;
  source?: string;
  confirmationEmailSent: boolean;
  enrolledAt: string;
}

export interface BatchFeedback {
  id: string;
  batchId: string;
  userId: string;
  feedback: string;
  contentRating: number;
  instructorsRating: number;
  valueRating: number;
  createdAt: string;
}

export interface LiveClass {
  id: string;
  batchId: string;
  title: string;
  description?: string;
  /** YYYY-MM-DD */
  date: string;
  /** HH:mm */
  time: string;
  durationMinutes: number;
  timezone: string;
  hostId: string;
  provider: "zoom" | "google_meet" | "custom";
  joinUrl: string;
  startUrl?: string;
  meetingId?: string;
  password?: string;
  autoRecording: "none" | "local" | "cloud";
  /** Self-hosted recording URL for playback in the custom player. */
  recordingUrl?: string;
  attendeeIds: string[];
  createdAt: string;
}

export interface Announcement {
  id: string;
  /** One of courseId / batchId is set. */
  courseId?: string;
  batchId?: string;
  authorId: string;
  subject: string;
  /** Markdown */
  body: string;
  /** Email addresses of extra recipients (CC). */
  cc?: string[];
  createdAt: string;
}

export interface EmailTemplate {
  id: string;
  name: string;
  subject: string;
  /** Markdown/HTML with {{ placeholders }} */
  body: string;
  batchId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Program {
  id: string;
  slug: string;
  title: string;
  description?: string;
  published: boolean;
  enforceCourseOrder: boolean;
  /** Ordered course ids. */
  courseIds: string[];
  createdById: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProgramMember {
  id: string;
  programId: string;
  userId: string;
  /** 0-100 */
  progress: number;
  joinedAt: string;
}

/* ------------------------------------------------------------------ */
/* Certificates & evaluations                                          */
/* ------------------------------------------------------------------ */

export interface Certificate {
  id: string;
  /** Short public verification code, e.g. "LL-8F3K-2Q9Z". */
  code: string;
  userId: string;
  courseId?: string;
  batchId?: string;
  evaluatorId?: string;
  issueDate: string;
  expiryDate?: string;
  published: boolean;
  /** Certificate template id from settings. */
  templateId?: string;
}

export type EvaluationStatus = "upcoming" | "completed" | "cancelled";

/** A learner's booked evaluation slot (Frappe: LMS Certificate Request). */
export interface CertificateRequest {
  id: string;
  courseId: string;
  batchId?: string;
  userId: string;
  evaluatorId: string;
  /** YYYY-MM-DD */
  date: string;
  /** HH:mm */
  startTime: string;
  endTime: string;
  timezone: string;
  meetingLink?: string;
  status: EvaluationStatus;
  createdAt: string;
}

export interface CertificateEvaluation {
  id: string;
  courseId: string;
  batchId?: string;
  userId: string;
  evaluatorId: string;
  rating: number;
  summary?: string;
  date: string;
  startTime: string;
  endTime?: string;
  status: "pending" | "in_progress" | "pass" | "fail";
  createdAt: string;
}

/** Weekly availability of an evaluator (Frappe: Evaluator Schedule). */
export interface EvaluatorSlot {
  id: string;
  evaluatorId: string;
  /** 0 = Sunday … 6 = Saturday */
  day: number;
  startTime: string;
  endTime: string;
  /**
   * Evaluator unavailability range (Frappe: unavailable_from / unavailable_to),
   * YYYY-MM-DD, inclusive. Stored on every slot row of the evaluator with the
   * same values; no bookings are offered or accepted on these dates.
   */
  unavailableFrom?: string;
  unavailableTo?: string;
}

/* ------------------------------------------------------------------ */
/* Badges, streaks, notifications                                      */
/* ------------------------------------------------------------------ */

export type BadgeEvent =
  | "course_enrolled"
  | "course_completed"
  | "quiz_passed"
  | "assignment_passed"
  | "certificate_issued"
  | "streak_7"
  | "streak_30"
  | "manual";

export interface Badge {
  id: string;
  title: string;
  description: string;
  imageUrl: string;
  event: BadgeEvent;
  /** Optional threshold, e.g. number of courses completed. */
  threshold?: number;
  grantOnlyOnce: boolean;
  enabled: boolean;
  createdAt: string;
}

export interface BadgeAssignment {
  id: string;
  badgeId: string;
  userId: string;
  issuedOn: string;
}

export type ActivityType =
  | "lesson_view"
  | "lesson_complete"
  | "quiz_submit"
  | "assignment_submit"
  | "exercise_submit"
  | "enroll"
  | "login";

export interface Activity {
  id: string;
  userId: string;
  /** YYYY-MM-DD (used for streaks and heatmaps). */
  date: string;
  type: ActivityType;
  refId?: string;
  createdAt: string;
}

export type NotificationType =
  | "enrollment"
  | "course_published"
  | "batch_published"
  | "live_class"
  | "assignment_graded"
  | "quiz_graded"
  | "certificate"
  | "badge"
  | "mention"
  | "reply"
  | "announcement"
  | "system";

export interface Notification {
  id: string;
  userId: string;
  fromUserId?: string;
  type: NotificationType;
  subject: string;
  message?: string;
  link?: string;
  read: boolean;
  /** Optional idempotency key (e.g. "batch-start:<batchId>:<date>") so automatic reminders are sent once. */
  dedupeKey?: string;
  createdAt: string;
}

/* ------------------------------------------------------------------ */
/* Discussions                                                         */
/* ------------------------------------------------------------------ */

export type DiscussionRefType = "lesson" | "course" | "batch";

export interface DiscussionTopic {
  id: string;
  refType: DiscussionRefType;
  refId: string;
  courseId?: string;
  batchId?: string;
  authorId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface DiscussionReply {
  id: string;
  topicId: string;
  authorId: string;
  /** Markdown */
  content: string;
  createdAt: string;
  updatedAt: string;
}

/* ------------------------------------------------------------------ */
/* Commerce                                                            */
/* ------------------------------------------------------------------ */

/**
 * What an order buys. Round 3 wave B adds membership plans, bundles, gifts
 * (a course/bundle/plan bought for someone else) and team seats.
 */
export type PaymentItemType = "course" | "batch" | "certificate" | "plan" | "bundle" | "gift" | "seats";
export type PaymentStatus = "pending" | "paid" | "failed" | "refunded";

export interface Payment {
  id: string;
  orderId: string;
  userId: string;
  itemType: PaymentItemType;
  itemId: string;
  itemTitle: string;
  originalAmount: number;
  discountAmount: number;
  taxAmount: number;
  amount: number;
  currency: string;
  couponId?: string;
  couponCode?: string;
  billingName: string;
  address?: {
    line1: string;
    line2?: string;
    city: string;
    state?: string;
    country: string;
    pincode?: string;
  };
  gstin?: string;
  pan?: string;
  source?: string;
  gateway: string;
  gatewayPaymentId?: string;
  status: PaymentStatus;
  createdAt: string;
  paidAt?: string;
  /** When the learner was last reminded to complete this unpaid order. */
  lastReminderAt?: string;
  /* ----- round 2: real gateways ----- */
  /** Stripe Checkout Session id or Razorpay order id. */
  gatewayOrderId?: string;
  /** Hosted checkout URL (Stripe) to resume a pending payment. */
  checkoutUrl?: string;
  /** Sequential invoice number assigned when paid, e.g. INV-2026-00042. */
  invoiceNumber?: string;
  refundId?: string;
  refundedAmount?: number;
  refundedAt?: string;
  failureReason?: string;
  /** Gateway refunds recorded on this order (deduplicates redelivered refund webhooks). */
  refunds?: { id: string; amount: number; at: string }[];
  /* ----- round 3 wave B: plans, bundles, gifts, teams, installments, affiliates, tax ----- */
  planId?: string;
  bundleId?: string;
  giftId?: string;
  /** Organization the seats were bought for (itemType "seats"). */
  orgId?: string;
  /** Number of seats bought (itemType "seats"). */
  seats?: number;
  subscriptionId?: string;
  /** 1-based part number when the course is paid in installments. */
  installmentNumber?: number;
  installmentsTotal?: number;
  /** Affiliate credited with the sale (last click within the cookie window). */
  affiliateId?: string;
  /** ISO 3166-1 alpha-2 country the tax was computed for. */
  taxCountry?: string;
  /** Tax rate applied, in percent. */
  taxRate?: number;
  /** Set on a one-click upsell order: the order whose checkout offered it. */
  upsellOfPaymentId?: string;
}

export interface Coupon {
  id: string;
  code: string;
  discountType: "percentage" | "fixed";
  /** Percentage (0-100) or fixed amount in cents. */
  value: number;
  expiresOn?: string;
  /** 0 = unlimited */
  usageLimit: number;
  redemptionCount: number;
  enabled: boolean;
  /** Empty = applies to everything. */
  applicableItems: { type: "course" | "batch"; id: string }[];
  createdAt: string;
}

/* ------------------------------------------------------------------ */
/* Jobs                                                                */
/* ------------------------------------------------------------------ */

export type JobType = "full_time" | "part_time" | "contract" | "freelance" | "internship";

export interface JobOpening {
  id: string;
  slug: string;
  title: string;
  company: string;
  companyLogoUrl?: string;
  companyWebsite?: string;
  location: string;
  /** Kept for backward compatibility; mirrors `workMode === "remote"`. */
  remote: boolean;
  /** Optional country (added for the Country filter on /jobs). */
  country?: string;
  /** On-site, remote or hybrid. When missing, derived from `remote`. */
  workMode?: "onsite" | "remote" | "hybrid";
  type: JobType;
  /** Markdown */
  description: string;
  salaryRange?: string;
  postedById: string;
  status: "open" | "closed";
  createdAt: string;
  updatedAt: string;
}

export interface JobApplication {
  id: string;
  jobId: string;
  userId: string;
  resumeUrl?: string;
  coverLetter?: string;
  createdAt: string;
}

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

export interface SidebarItem {
  id: string;
  label: string;
  href: string;
  icon?: string;
  order: number;
}

export interface Settings {
  brand: {
    name: string;
    tagline: string;
    logoUrl?: string;
    faviconUrl?: string;
    /** Hex accent color, e.g. "#4f46e5" */
    accentColor: string;
    metaDescription?: string;
    metaImageUrl?: string;
    metaKeywords?: string;
    footerText?: string;
  };
  features: {
    courses: boolean;
    batches: boolean;
    programs: boolean;
    jobs: boolean;
    statistics: boolean;
    notifications: boolean;
    programmingExercises: boolean;
    certifications: boolean;
    certifiedMembers: boolean;
    discussions: boolean;
    reviews: boolean;
    notes: boolean;
    badges: boolean;
    liveClasses: boolean;
  };
  learning: {
    allowGuestAccess: boolean;
    disableSignup: boolean;
    /** Seconds a learner must stay on a lesson before it can be marked complete. */
    lessonDwellTimeSeconds: number;
    enforceVideoCompletion: boolean;
    enforceQuizCompletion: boolean;
    enforceAssignmentCompletion: boolean;
    preventSkippingVideos: boolean;
    /** Percentage of a video that counts as "watched". */
    videoCompletionThreshold: number;
    defaultHome: "courses" | "dashboard";
    notifyOnPublishedCourses: "none" | "email" | "in_app";
    notifyOnPublishedBatches: "none" | "email" | "in_app";
  };
  commerce: {
    defaultCurrency: string;
    paymentGateway: "none" | "manual" | "stripe" | "razorpay";
    applyTax: boolean;
    taxPercentage: number;
    taxLabel: string;
    showUsdEquivalent: boolean;
    applyRounding: boolean;
    sendPaymentReminders: boolean;
  };
  contact: {
    email?: string;
    url?: string;
  };
  sidebarItems: SidebarItem[];
  /** Markdown shown on the signup page. */
  customSignupContent?: string;
  textDirection: "auto" | "ltr" | "rtl";
  /* ----- round 2 ----- */
  email: {
    /** Master switch for sending email notifications (transactional auth emails always send). */
    enabled: boolean;
    fromName: string;
    replyTo?: string;
    footerText?: string;
    /** In-app notification types that also send an email. */
    notifyTypes: NotificationType[];
    /** Round 3 wave B: add an open-tracking pixel to marketing emails (broadcasts, sequences). */
    trackOpens: boolean;
    /** Round 3 wave B: rewrite links in marketing emails through the click tracker. */
    trackClicks: boolean;
  };
  security: {
    requireEmailVerification: boolean;
    allowTwoFactor: boolean;
    enforceTwoFactorForStaff: boolean;
    maxLoginAttempts: number;
    lockoutMinutes: number;
    passwordMinLength: number;
  };
  video: {
    /** Require signed, expiring URLs for uploaded lesson videos. */
    protectUploads: boolean;
    signedUrlMinutes: number;
    watermark: boolean;
    /** 0.05 – 0.5 */
    watermarkOpacity: number;
    seekThumbnails: boolean;
    autoplayNext: boolean;
  };
  pwa: {
    enabled: boolean;
    installPrompt: boolean;
    offlinePage: boolean;
  };
  gamification: {
    enabled: boolean;
    showLeaderboard: boolean;
    /** Exclude staff (admins, moderators, course creators, evaluators) from leaderboards. */
    excludeStaff: boolean;
    points: Record<PointsReason, number>;
    /** Round 2 fix: when the ledger was first filled from history (unset = the one-time backfill has not succeeded yet). */
    ledgerBuiltAt?: string;
  };
  /* ----- round 3 ----- */
  seo: {
    /** `%s` is replaced by the page title, e.g. "%s · LearnLoop". */
    siteTitleTemplate: string;
    defaultDescription: string;
    defaultOgImageUrl?: string;
    /** "@handle" for Twitter/X cards. */
    twitterHandle?: string;
    /** Google Search Console verification token. */
    googleVerification?: string;
    /** Bing Webmaster Tools verification token. */
    bingVerification?: string;
    /** Organization name used in structured data. */
    organizationName: string;
    organizationLogoUrl?: string;
    /** Official profile URLs for Organization.sameAs. */
    sameAs: string[];
    /** IndexNow key (enables pinging search engines when content is published). */
    indexNowKey?: string;
    blogEnabled: boolean;
    /** Ask search engines not to index the whole site (e.g. staging). */
    noindexSite: boolean;
    /** Google Analytics 4 measurement id (loaded only after analytics consent). */
    ga4Id?: string;
    /** Meta Pixel id (loaded only after marketing consent). */
    metaPixelId?: string;
  };
  legal: {
    cookieBanner: boolean;
    companyName: string;
    companyAddress?: string;
    contactEmail?: string;
    /** Days to keep logs and inactive personal data before purging. */
    dataRetentionDays: number;
  };
  ai: {
    enabled: boolean;
    model: string;
    /** Messages per learner per day (0 = unlimited). */
    dailyMessageLimit: number;
    /** Extra instructions added to the tutor's system prompt. */
    systemPrompt?: string;
    /** Collect flagged/unhelpful answers for instructor review. */
    reviewQueue: boolean;
  };
  storage: {
    /** Public CDN origin placed in front of stored media, e.g. "https://cdn.example.com". */
    cdnBaseUrl?: string;
    /** Convert uploaded lesson videos to adaptive HLS with ffmpeg. */
    transcodeToHls: boolean;
    /** Target rendition heights, e.g. [1080, 720, 480]. */
    renditions: number[];
    /** Generate captions automatically with the configured transcription API. */
    autoTranscribe: boolean;
  };
  /* ----- round 3 wave B ----- */
  growth: {
    affiliatesEnabled: boolean;
    /** New affiliates are active immediately (otherwise an admin approves them). */
    affiliateAutoApprove: boolean;
    /** Commission for new affiliates, in percent of the net (tax-exclusive) sale. */
    defaultCommissionPercent: number;
    /** How long a referral cookie keeps attributing sales. */
    cookieDays: number;
    abandonedCheckoutEnabled: boolean;
    /** Hours after the checkout was abandoned at which reminders are sent, e.g. [1, 24, 72]. */
    abandonedCheckoutDelaysHours: number[];
    /** Discount of the coupon included in the last reminder (0 = none). */
    abandonedCheckoutCouponPercent: number;
    giftsEnabled: boolean;
    teamsEnabled: boolean;
    subscriptionsEnabled: boolean;
    bundlesEnabled: boolean;
    installmentsEnabled: boolean;
    taxMode: "none" | "by_country";
    /** Show and charge fixed prices in the buyer's currency when an item defines one. */
    multiCurrency: boolean;
  };
  marketplace: {
    /** Multi-instructor marketplace with revenue sharing. */
    enabled: boolean;
    /** Instructor share of net course revenue, in percent. */
    defaultRevenueSharePercent: number;
    /** Members can apply to teach from /teach. */
    allowApplications: boolean;
  };
  api: {
    /** Public REST API (/api/v1) and outgoing webhooks. */
    enabled: boolean;
  };
  messaging: {
    /** Direct messages between learners and instructors. */
    enabled: boolean;
    /** Learners may also message other learners. */
    studentToStudent: boolean;
  };
  updatedAt: string;
}

/* ------------------------------------------------------------------ */
/* Round 2: email outbox, auth tokens, login events, points            */
/* ------------------------------------------------------------------ */

export type EmailStatus = "queued" | "sending" | "sent" | "failed";

export type EmailCategory =
  | "password_reset"
  | "email_verification"
  | "welcome"
  | "notification"
  | "announcement"
  | "batch"
  | "payment"
  | "reminder"
  | "test"
  | "other";

export interface EmailMessage {
  id: string;
  to: string;
  toName?: string;
  cc?: string[];
  userId?: string;
  subject: string;
  html: string;
  text: string;
  category: EmailCategory;
  status: EmailStatus;
  attempts: number;
  lastError?: string;
  /** SMTP Message-ID of the delivered message. */
  messageId?: string;
  nextAttemptAt?: string;
  createdAt: string;
  sentAt?: string;
}

export type AuthTokenPurpose = "password_reset" | "email_verification" | "two_factor_login";

export interface AuthToken {
  id: string;
  userId: string;
  purpose: AuthTokenPurpose;
  /** SHA-256 hex of the raw token; the raw token is never stored. */
  tokenHash: string;
  expiresAt: string;
  usedAt?: string;
  createdAt: string;
}

export interface LoginEvent {
  id: string;
  userId?: string;
  email: string;
  success: boolean;
  /** e.g. "bad_password", "unknown_email", "locked", "disabled", "2fa_failed", "2fa_ok", "password_reset" */
  reason?: string;
  ip?: string;
  userAgent?: string;
  createdAt: string;
}

/**
 * Round 2 fix (account security): consecutive failed sign-ins for one email
 * address, kept the same way whether or not an account exists for it, so
 * lockouts never reveal which addresses are registered.
 */
export interface LoginThrottle {
  id: string;
  /** HMAC-SHA256 of the normalised email address (keyed from APP_SECRET); addresses are not stored. */
  keyHash: string;
  /** Failures since the last success, lock or reset (forgotten a day after the last one). */
  failures: number;
  lastFailureAt: string;
  /** Sign-in for this address is refused until then. */
  lockedUntil?: string;
}

export type PointsReason =
  | "lesson_complete"
  | "quiz_pass"
  | "quiz_perfect"
  | "assignment_submit"
  | "assignment_pass"
  | "exercise_pass"
  | "course_complete"
  | "certificate"
  | "streak_day"
  | "discussion_reply"
  | "review"
  | "manual";

export interface PointsEntry {
  id: string;
  userId: string;
  points: number;
  reason: PointsReason;
  refId?: string;
  courseId?: string;
  note?: string;
  createdAt: string;
}

/* ------------------------------------------------------------------ */
/* Round 3: uploads, transcoding, transcripts                          */
/* ------------------------------------------------------------------ */

export type UploadKind = "video" | "image" | "document";

/** A resumable (chunked) upload in progress. */
export interface UploadSession {
  id: string;
  userId: string;
  kind: UploadKind;
  fileName: string;
  mimeType: string;
  /** Total size in bytes declared when the upload started. */
  size: number;
  /** Bytes received so far (the offset the next chunk must start at). */
  received: number;
  /** Storage-driver key the bytes are written to. */
  storageKey: string;
  status: "uploading" | "complete" | "aborted";
  createdAt: string;
  updatedAt: string;
  /** URL of the finished file once the upload completed. */
  completedUrl?: string;
}

/** A queued ffmpeg job converting an uploaded video to HLS. */
export interface TranscodeJob {
  id: string;
  lessonId: string;
  blockId: string;
  /** Storage key of the source video. */
  sourceKey: string;
  status: "queued" | "running" | "done" | "failed";
  /** 0-100 */
  progress: number;
  attempts: number;
  error?: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface TranscriptCue {
  /** Seconds from the start of the video. */
  start: number;
  end: number;
  text: string;
}

/** Timed transcript of a lesson video (captions, transcript panel, AI tutor context). */
export interface Transcript {
  id: string;
  lessonId: string;
  blockId: string;
  /** BCP 47 language tag, e.g. "en". */
  language: string;
  cues: TranscriptCue[];
  source: "upload" | "auto" | "manual";
  status: "ready" | "processing" | "failed";
  error?: string;
  createdAt: string;
  updatedAt: string;
}

/* ------------------------------------------------------------------ */
/* Round 3: blog, SEO, leads                                           */
/* ------------------------------------------------------------------ */

export type BlogPostStatus = "draft" | "scheduled" | "published";

export interface BlogPost {
  id: string;
  slug: string;
  title: string;
  /** Plain-text summary for cards and meta descriptions. */
  excerpt: string;
  /** Markdown */
  content: string;
  coverImageUrl?: string;
  authorId: string;
  /** Uses the shared course categories. */
  categoryIds: string[];
  tags: string[];
  status: BlogPostStatus;
  /** Publication time (in the future for scheduled posts). */
  publishedAt?: string;
  seoTitle?: string;
  seoDescription?: string;
  canonicalUrl?: string;
  noindex?: boolean;
  focusKeyword?: string;
  faq?: FaqItem[];
  relatedCourseIds: string[];
  readingTimeSeconds: number;
  views: number;
  createdAt: string;
  updatedAt: string;
}

/** Permanent (308) redirect kept when a course, post or page slug changes. */
export interface SlugRedirect {
  id: string;
  /** Absolute path, e.g. "/courses/old-slug". */
  fromPath: string;
  toPath: string;
  createdAt: string;
}

/** Marketing lead (newsletter, free lesson, waitlist, …). */
export interface Lead {
  id: string;
  /** Lower-cased email address. */
  email: string;
  name?: string;
  /** Where the lead was captured, e.g. "blog", "course:crs_js", "footer". */
  source: string;
  courseId?: string;
  /** Explicit marketing consent given when subscribing. */
  consent: boolean;
  /** Double opt-in confirmation time. */
  confirmedAt?: string;
  unsubscribedAt?: string;
  createdAt: string;
}

/* ------------------------------------------------------------------ */
/* Round 3: legal, compliance, observability                           */
/* ------------------------------------------------------------------ */

export interface LegalPage {
  id: string;
  /** "privacy" | "terms" | "refunds" | "cookies" | a custom slug */
  slug: string;
  title: string;
  /** Markdown */
  content: string;
  updatedAt: string;
  /** Incremented on every published change. */
  version: number;
  published: boolean;
}

/** A visitor's cookie-consent decision (anonymous until they sign in). */
export interface ConsentRecord {
  id: string;
  userId?: string;
  /** Random visitor id from the `ll_anon` cookie, so anonymous decisions can be evidenced. */
  anonId: string;
  analytics: boolean;
  marketing: boolean;
  createdAt: string;
}

/** Security-relevant action recorded for the admin audit log. */
export interface AuditEvent {
  id: string;
  actorId?: string;
  /** Dotted verb, e.g. "course.publish", "user.roles", "settings.update". */
  action: string;
  targetType?: string;
  targetId?: string;
  meta?: Record<string, string | number | boolean | null>;
  ip?: string;
  createdAt: string;
}

/** Server error captured for the admin error log (deduplicated by message + digest + path). */
export interface ErrorEvent {
  id: string;
  message: string;
  stack?: string;
  digest?: string;
  path?: string;
  method?: string;
  userId?: string;
  createdAt: string;
  /** Occurrences since first seen. */
  count: number;
  lastSeenAt: string;
  resolved?: boolean;
}

/** Personal-data export or erasure request. */
export interface DataRequest {
  id: string;
  userId: string;
  type: "export" | "delete";
  status: "pending" | "completed" | "cancelled";
  createdAt: string;
  completedAt?: string;
}

/* ------------------------------------------------------------------ */
/* Round 3: AI tutor                                                   */
/* ------------------------------------------------------------------ */

export interface AiConversation {
  id: string;
  userId: string;
  courseId: string;
  lessonId?: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

/** A lesson passage an AI answer is grounded in. */
export interface AiCitation {
  lessonId: string;
  title: string;
  snippet: string;
  /** Video timestamp of the passage when it comes from a transcript. */
  seconds?: number;
}

export interface AiMessage {
  id: string;
  conversationId: string;
  role: "user" | "assistant";
  content: string;
  citations?: AiCitation[];
  /** The learner flagged the answer as wrong or inappropriate. */
  flagged?: boolean;
  /** Learner feedback: thumbs up (true) / down (false). */
  helpful?: boolean;
  reviewStatus?: "pending" | "approved" | "corrected";
  /** Instructor correction or comment shown to the learner. */
  instructorNote?: string;
  tokensIn?: number;
  tokensOut?: number;
  createdAt: string;
}

/* ------------------------------------------------------------------ */
/* Round 3 wave B: memberships, bundles, gifts, upsells, tax            */
/* ------------------------------------------------------------------ */

export type PlanInterval = "month" | "year" | "one_time";

/** What a membership plan unlocks. */
export type PlanAccess = { type: "all" } | { type: "courses"; courseIds: string[] };

export interface MembershipPlan {
  id: string;
  slug: string;
  name: string;
  /** Markdown */
  description: string;
  interval: PlanInterval;
  /** Price per interval in the smallest currency unit. */
  price: number;
  currency: string;
  /** Free days before the first charge (0 = none). */
  trialDays: number;
  access: PlanAccess;
  active: boolean;
  /** Bullet points shown on the pricing page. */
  features: string[];
  /** Recurring price ids created on the gateways. */
  gatewayPriceIds?: { stripe?: string; razorpay?: string };
  prices?: CurrencyPrice[];
  createdAt: string;
  updatedAt: string;
}

export type SubscriptionStatus = "trialing" | "active" | "past_due" | "cancelled" | "expired";

export interface Subscription {
  id: string;
  userId: string;
  planId: string;
  status: SubscriptionStatus;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  /** The member cancelled; access continues until `currentPeriodEnd`. */
  cancelAtPeriodEnd: boolean;
  gateway: string;
  gatewaySubscriptionId?: string;
  createdAt: string;
  updatedAt: string;
}

/** Several courses sold together at one price. */
export interface Bundle {
  id: string;
  slug: string;
  title: string;
  /** Markdown */
  description: string;
  courseIds: string[];
  /** Smallest currency unit. */
  price: number;
  currency: string;
  prices?: CurrencyPrice[];
  imageUrl?: string;
  published: boolean;
  createdAt: string;
  updatedAt: string;
}

/** A course, bundle or plan bought for someone else, redeemed with a code. */
export interface Gift {
  id: string;
  /** Redemption code (share-safe, e.g. "GIFT-8F3K-2Q9Z"). */
  code: string;
  purchaserId: string;
  recipientEmail: string;
  recipientName?: string;
  message?: string;
  itemType: "course" | "bundle" | "plan";
  itemId: string;
  paymentId: string;
  /** Deliver the gift email at this time (immediately when unset). */
  sendAt?: string;
  sentAt?: string;
  redeemedBy?: string;
  redeemedAt?: string;
  createdAt: string;
}

/** One-click offer shown after buying the trigger item. */
export interface Upsell {
  id: string;
  triggerItemType: "course" | "bundle";
  triggerItemId: string;
  offerItemType: "course" | "bundle";
  offerItemId: string;
  /** 0-100 */
  discountPercent: number;
  headline: string;
  active: boolean;
  createdAt: string;
}

/** Tax rate for buyers in one country (used when `settings.growth.taxMode` is "by_country"). */
export interface TaxRule {
  id: string;
  /** ISO 3166-1 alpha-2, e.g. "IN". */
  country: string;
  /** Label on invoices, e.g. "GST", "VAT". */
  name: string;
  /** Percent, e.g. 18. */
  rate: number;
  /** Prices already include the tax (the tax is carved out instead of added). */
  inclusive: boolean;
}

/** A started checkout, tracked for abandoned-checkout recovery emails. */
export interface CheckoutSession {
  id: string;
  userId?: string;
  email?: string;
  itemType: string;
  itemId: string;
  startedAt: string;
  lastStepAt: string;
  completedPaymentId?: string;
  /** The buyer completed a purchase after a reminder. */
  recoveredAt?: string;
  reminderCount: number;
  lastReminderAt?: string;
  /** Coupon code sent with the last reminder. */
  couponSent?: string;
}

/* ------------------------------------------------------------------ */
/* Round 3 wave B: affiliates, teams, analytics                         */
/* ------------------------------------------------------------------ */

export interface Affiliate {
  id: string;
  userId: string;
  /** Referral code used in `?ref=CODE` links. */
  code: string;
  commissionPercent: number;
  status: "pending" | "active" | "paused";
  payoutEmail?: string;
  createdAt: string;
}

/** A visit that arrived through an affiliate link. */
export interface AffiliateReferral {
  id: string;
  affiliateId: string;
  /** Anonymous visitor id (`ll_anon` cookie). */
  visitorId: string;
  landingPath: string;
  createdAt: string;
  convertedPaymentId?: string;
}

export interface Commission {
  id: string;
  affiliateId: string;
  paymentId: string;
  amount: number;
  currency: string;
  status: "pending" | "approved" | "paid" | "void";
  createdAt: string;
  paidAt?: string;
}

/** A company or team that buys seats for its members. */
export interface Organization {
  id: string;
  name: string;
  slug: string;
  ownerId: string;
  /** Members who can manage seats and see team progress (the owner always can). */
  managerIds: string[];
  seatCount: number;
  /** Courses every seat holder gets. */
  courseIds: string[];
  createdAt: string;
}

export interface OrgSeat {
  id: string;
  orgId: string;
  /** Set once the invitation was accepted. */
  userId?: string;
  email: string;
  /** SHA-256 hex of the invitation token (the raw token is only emailed). */
  inviteTokenHash?: string;
  status: "invited" | "active" | "revoked";
  assignedAt: string;
  activatedAt?: string;
}

/** First-party analytics event (page views, funnel steps, purchases). */
export interface AnalyticsEvent {
  id: string;
  /** e.g. "page_view", "checkout_started", "purchase", "signup". */
  name: string;
  path?: string;
  userId?: string;
  anonId?: string;
  referrer?: string;
  utm?: { source?: string; medium?: string; campaign?: string };
  itemType?: string;
  itemId?: string;
  value?: number;
  currency?: string;
  createdAt: string;
}

/* ------------------------------------------------------------------ */
/* Round 3 wave B: broadcasts, sequences, direct messages               */
/* ------------------------------------------------------------------ */

/** Audience of a broadcast (all conditions must match). */
export interface SegmentFilter {
  courseIds?: string[];
  notEnrolledCourseIds?: string[];
  roles?: Role[];
  /** No activity for at least this many days. */
  inactiveDays?: number;
  /** true = has a paid order, false = never paid. */
  purchased?: boolean;
  /** Marketing leads without an account. */
  leadsOnly?: boolean;
}

export interface Broadcast {
  id: string;
  subject: string;
  /** Markdown */
  body: string;
  segment: SegmentFilter;
  status: "draft" | "scheduled" | "sending" | "sent";
  scheduledAt?: string;
  sentAt?: string;
  recipients: number;
  opens: number;
  clicks: number;
  createdById: string;
  createdAt: string;
  updatedAt: string;
}

export type SequenceTrigger = "signup" | "lead" | "enrollment" | "purchase" | "inactive";

export interface EmailSequenceStep {
  id: string;
  /** Hours after the previous step (or the trigger for the first step). */
  delayHours: number;
  subject: string;
  /** Markdown */
  body: string;
}

/** Automated drip email series. */
export interface EmailSequence {
  id: string;
  name: string;
  trigger: SequenceTrigger;
  /** Limit "enrollment"/"purchase" triggers to one course. */
  courseId?: string;
  /** For the "inactive" trigger. */
  inactiveDays?: number;
  steps: EmailSequenceStep[];
  active: boolean;
  createdAt: string;
}

export interface SequenceEnrollment {
  id: string;
  sequenceId: string;
  userId?: string;
  leadId?: string;
  email: string;
  nextStepIndex: number;
  nextRunAt: string;
  status: "active" | "completed" | "stopped";
  createdAt: string;
}

/** Open/click recorded for a tracked email. */
export interface EmailEvent {
  id: string;
  /** Id of the `EmailMessage`. */
  emailId: string;
  type: "open" | "click";
  url?: string;
  createdAt: string;
}

export interface Conversation {
  id: string;
  participantIds: string[];
  /** Course the conversation is about (e.g. "Message instructor"). */
  courseId?: string;
  subject?: string;
  lastMessageAt: string;
  /** A participant reported the conversation to moderators. */
  reported?: boolean;
  createdAt: string;
}

export interface DirectMessage {
  id: string;
  conversationId: string;
  senderId: string;
  /** Plain text / markdown (rendered escaped). */
  body: string;
  /** Users who have read the message (the sender included). */
  readBy: string[];
  createdAt: string;
  editedAt?: string;
}

/* ------------------------------------------------------------------ */
/* Round 3 wave B: public API & webhooks                                */
/* ------------------------------------------------------------------ */

export interface ApiKey {
  id: string;
  name: string;
  /** First characters of the key, shown to identify it (e.g. "ll_live_ab12"). */
  prefix: string;
  /** SHA-256 hex of the full key; the key itself is shown once. */
  keyHash: string;
  /** e.g. "courses:read", "enrollments:write". */
  scopes: string[];
  createdById: string;
  lastUsedAt?: string;
  revokedAt?: string;
  createdAt: string;
}

export interface WebhookEndpoint {
  id: string;
  url: string;
  /** Signing secret, encrypted at rest. */
  secretEnc: string;
  /** Subscribed domain event names. */
  events: string[];
  active: boolean;
  /** Consecutive failed deliveries (reset on success). */
  failureCount: number;
  createdAt: string;
  lastDeliveryAt?: string;
}

export interface WebhookDelivery {
  id: string;
  endpointId: string;
  event: string;
  /** JSON body sent to the endpoint. */
  payload: string;
  status: "pending" | "success" | "failed";
  attempts: number;
  responseStatus?: number;
  /** Truncated response body. */
  responseBody?: string;
  nextAttemptAt?: string;
  createdAt: string;
  deliveredAt?: string;
}

/* ------------------------------------------------------------------ */
/* Round 3 wave B: rubrics, peer review, versions, marketplace          */
/* ------------------------------------------------------------------ */

export interface RubricLevel {
  label: string;
  points: number;
  description?: string;
}

export interface RubricCriterion {
  id: string;
  title: string;
  description?: string;
  /** Performance levels, usually from lowest to highest. */
  levels: RubricLevel[];
}

export interface Rubric {
  id: string;
  title: string;
  criteria: RubricCriterion[];
  /** Percentage of the maximum points needed to pass (0-100). */
  passPercent: number;
  createdById: string;
  createdAt: string;
  updatedAt: string;
}

export interface RubricScore {
  criterionId: string;
  /** Index into the criterion's `levels`. */
  levelIndex: number;
  points: number;
  comment?: string;
}

export interface PeerReview {
  id: string;
  submissionId: string;
  reviewerId: string;
  assignmentId: string;
  scores?: RubricScore[];
  comment: string;
  status: "assigned" | "submitted";
  assignedAt: string;
  submittedAt?: string;
}

/** Snapshot of a lesson taken before each save (lesson history). */
export interface LessonVersion {
  id: string;
  lessonId: string;
  title: string;
  blocks: LessonBlock[];
  instructorNotes?: string;
  savedById: string;
  note?: string;
  createdAt: string;
}

export interface InstructorProfile {
  id: string;
  userId: string;
  /** Instructor share of net course revenue, in percent. */
  revenueSharePercent: number;
  status: "applied" | "approved" | "rejected";
  /** Application text (bio, expertise, sample). */
  application?: string;
  rejectionReason?: string;
  payoutEmail?: string;
  createdAt: string;
  reviewedAt?: string;
}

/** An instructor's share of one paid order. */
export interface Earning {
  id: string;
  /** User id of the instructor. */
  instructorId: string;
  paymentId: string;
  courseId: string;
  /** Net amount of the order attributed to the course. */
  gross: number;
  /** Instructor share of `gross`. */
  share: number;
  currency: string;
  status: "pending" | "paid" | "void";
  createdAt: string;
  paidAt?: string;
}

/** Money paid out to an instructor or an affiliate. */
export interface Payout {
  id: string;
  instructorId?: string;
  affiliateId?: string;
  amount: number;
  currency: string;
  /** e.g. "bank_transfer", "paypal". */
  method: string;
  reference?: string;
  createdAt: string;
}

/* ------------------------------------------------------------------ */
/* Persisted database                                                  */
/* ------------------------------------------------------------------ */

export interface Database {
  users: User[];
  sessions: Session[];
  categories: Category[];
  courses: Course[];
  chapters: Chapter[];
  lessons: Lesson[];
  questions: Question[];
  quizzes: Quiz[];
  quizSubmissions: QuizSubmission[];
  quizViolations: QuizViolation[];
  assignments: Assignment[];
  assignmentSubmissions: AssignmentSubmission[];
  exercises: ProgrammingExercise[];
  exerciseSubmissions: ExerciseSubmission[];
  enrollments: Enrollment[];
  progress: LessonProgress[];
  videoWatches: VideoWatch[];
  notes: LessonNote[];
  reviews: Review[];
  batches: Batch[];
  batchEnrollments: BatchEnrollment[];
  batchFeedback: BatchFeedback[];
  liveClasses: LiveClass[];
  announcements: Announcement[];
  emailTemplates: EmailTemplate[];
  programs: Program[];
  programMembers: ProgramMember[];
  certificates: Certificate[];
  certificateRequests: CertificateRequest[];
  certificateEvaluations: CertificateEvaluation[];
  evaluatorSlots: EvaluatorSlot[];
  badges: Badge[];
  badgeAssignments: BadgeAssignment[];
  activities: Activity[];
  notifications: Notification[];
  discussionTopics: DiscussionTopic[];
  discussionReplies: DiscussionReply[];
  payments: Payment[];
  coupons: Coupon[];
  jobs: JobOpening[];
  jobApplications: JobApplication[];
  /* round 2 */
  emails: EmailMessage[];
  authTokens: AuthToken[];
  loginEvents: LoginEvent[];
  points: PointsEntry[];
  /** Round 2 fix: persisted sign-in failure counters (account security). */
  loginThrottles: LoginThrottle[];
  /* round 3 */
  uploadSessions: UploadSession[];
  transcodeJobs: TranscodeJob[];
  transcripts: Transcript[];
  blogPosts: BlogPost[];
  slugRedirects: SlugRedirect[];
  leads: Lead[];
  legalPages: LegalPage[];
  consents: ConsentRecord[];
  auditEvents: AuditEvent[];
  errorEvents: ErrorEvent[];
  dataRequests: DataRequest[];
  aiConversations: AiConversation[];
  aiMessages: AiMessage[];
  /* round 3 wave B */
  plans: MembershipPlan[];
  subscriptions: Subscription[];
  bundles: Bundle[];
  gifts: Gift[];
  upsells: Upsell[];
  taxRules: TaxRule[];
  checkoutSessions: CheckoutSession[];
  affiliates: Affiliate[];
  affiliateReferrals: AffiliateReferral[];
  commissions: Commission[];
  organizations: Organization[];
  orgSeats: OrgSeat[];
  analyticsEvents: AnalyticsEvent[];
  broadcasts: Broadcast[];
  emailSequences: EmailSequence[];
  sequenceEnrollments: SequenceEnrollment[];
  emailEvents: EmailEvent[];
  conversations: Conversation[];
  directMessages: DirectMessage[];
  apiKeys: ApiKey[];
  webhookEndpoints: WebhookEndpoint[];
  webhookDeliveries: WebhookDelivery[];
  rubrics: Rubric[];
  peerReviews: PeerReview[];
  lessonVersions: LessonVersion[];
  instructorProfiles: InstructorProfile[];
  earnings: Earning[];
  payouts: Payout[];
  settings: Settings;
}

export type CollectionName = Exclude<keyof Database, "settings">;

/* ------------------------------------------------------------------ */
/* Derived / view-model types shared between server and UI            */
/* ------------------------------------------------------------------ */

export interface LessonWithState extends Lesson {
  status: ProgressStatus;
  /** Whether the current viewer may open this lesson. */
  locked: boolean;
  /** 1-based chapter number and lesson number for URLs: /learn/1-2 */
  chapterNumber: number;
  lessonNumber: number;
  hasVideo: boolean;
  hasQuiz: boolean;
  hasAssignment: boolean;
  hasExercise: boolean;
}

export interface ChapterWithLessons extends Chapter {
  lessons: LessonWithState[];
}

export interface CourseSummary extends Course {
  instructors: PublicUser[];
  category: Category | null;
  lessonCount: number;
  chapterCount: number;
  totalDurationSeconds: number;
  enrollmentCount: number;
  averageRating: number | null;
  reviewCount: number;
  /** Set when the viewer is enrolled. */
  enrollment?: Enrollment | null;
  /** Viewer progress 0-100 (only if enrolled). */
  progress?: number;
}

export interface CourseProgressSummary {
  courseId: string;
  totalLessons: number;
  completedLessons: number;
  /** 0-100 */
  percent: number;
  completed: boolean;
  currentLessonId?: string;
}

export interface BatchSummary extends Batch {
  instructors: PublicUser[];
  category: Category | null;
  studentCount: number;
  seatsLeft: number | null;
  status: "upcoming" | "active" | "completed";
  enrolled?: boolean;
}

/** Standard result type for server actions. */
export type ActionResult<T = undefined> =
  | { ok: true; data: T; message?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };
