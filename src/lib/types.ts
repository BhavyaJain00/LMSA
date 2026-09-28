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
  createdById: string;
  createdAt: string;
  updatedAt: string;
}

export interface Chapter {
  id: string;
  courseId: string;
  title: string;
  description?: string;
  order: number;
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
  createdAt: string;
  updatedAt: string;
}

/* ------------------------------------------------------------------ */
/* Quizzes                                                             */
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
  authorId: string;
  createdAt: string;
  updatedAt: string;
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

export type PaymentItemType = "course" | "batch" | "certificate";
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
  remote: boolean;
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
  updatedAt: string;
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
