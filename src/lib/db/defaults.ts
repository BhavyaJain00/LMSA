import type { Settings } from "@/lib/types";

/** Settings used on first run and as a fallback for missing keys. */
export function defaultSettings(): Settings {
  return {
    brand: {
      name: "LearnLoop",
      tagline: "Learn by doing. Master real skills.",
      logoUrl: undefined,
      faviconUrl: undefined,
      accentColor: "#4f46e5",
      metaDescription:
        "A self-hosted learning platform with courses, cohorts, quizzes, assignments, live classes and certificates.",
      metaImageUrl: undefined,
      metaKeywords: "lms, courses, learning, training",
      footerText: "",
    },
    features: {
      courses: true,
      batches: true,
      programs: true,
      jobs: true,
      statistics: true,
      notifications: true,
      programmingExercises: true,
      certifications: true,
      certifiedMembers: true,
      discussions: true,
      reviews: true,
      notes: true,
      badges: true,
      liveClasses: true,
    },
    learning: {
      allowGuestAccess: true,
      disableSignup: false,
      lessonDwellTimeSeconds: 30,
      enforceVideoCompletion: true,
      enforceQuizCompletion: true,
      enforceAssignmentCompletion: true,
      preventSkippingVideos: false,
      videoCompletionThreshold: 90,
      defaultHome: "courses",
      notifyOnPublishedCourses: "in_app",
      notifyOnPublishedBatches: "in_app",
    },
    commerce: {
      defaultCurrency: "USD",
      paymentGateway: "manual",
      applyTax: false,
      taxPercentage: 0,
      taxLabel: "Tax",
      showUsdEquivalent: false,
      applyRounding: true,
      sendPaymentReminders: false,
    },
    contact: {
      email: "support@example.com",
      url: undefined,
    },
    sidebarItems: [],
    customSignupContent: undefined,
    textDirection: "auto",
    email: {
      enabled: true,
      fromName: "LearnLoop",
      replyTo: undefined,
      footerText: "You are receiving this email because you have an account on LearnLoop.",
      notifyTypes: ["enrollment", "live_class", "assignment_graded", "quiz_graded", "certificate", "announcement", "reply", "mention"],
    },
    security: {
      requireEmailVerification: false,
      allowTwoFactor: true,
      enforceTwoFactorForStaff: false,
      maxLoginAttempts: 8,
      lockoutMinutes: 15,
      passwordMinLength: 8,
    },
    video: {
      protectUploads: true,
      signedUrlMinutes: 60,
      watermark: false,
      watermarkOpacity: 0.18,
      seekThumbnails: true,
      autoplayNext: true,
    },
    pwa: {
      enabled: true,
      installPrompt: true,
      offlinePage: true,
    },
    gamification: {
      enabled: true,
      showLeaderboard: true,
      excludeStaff: true,
      points: {
        lesson_complete: 10,
        quiz_pass: 20,
        quiz_perfect: 10,
        assignment_submit: 10,
        assignment_pass: 25,
        exercise_pass: 25,
        course_complete: 100,
        certificate: 50,
        streak_day: 5,
        discussion_reply: 5,
        review: 10,
        manual: 0,
      },
    },
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

/** Deep-merge stored settings over defaults so new keys always exist. */
export function mergeSettings(stored: Partial<Settings> | undefined): Settings {
  const d = defaultSettings();
  if (!stored) return d;
  return {
    brand: { ...d.brand, ...(stored.brand ?? {}) },
    features: { ...d.features, ...(stored.features ?? {}) },
    learning: { ...d.learning, ...(stored.learning ?? {}) },
    commerce: { ...d.commerce, ...(stored.commerce ?? {}) },
    contact: { ...d.contact, ...(stored.contact ?? {}) },
    sidebarItems: stored.sidebarItems ?? d.sidebarItems,
    customSignupContent: stored.customSignupContent ?? d.customSignupContent,
    textDirection: stored.textDirection ?? d.textDirection,
    email: { ...d.email, ...(stored.email ?? {}) },
    security: { ...d.security, ...(stored.security ?? {}) },
    video: { ...d.video, ...(stored.video ?? {}) },
    pwa: { ...d.pwa, ...(stored.pwa ?? {}) },
    gamification: {
      ...d.gamification,
      ...(stored.gamification ?? {}),
      points: { ...d.gamification.points, ...(stored.gamification?.points ?? {}) },
    },
    updatedAt: stored.updatedAt ?? d.updatedAt,
  };
}
