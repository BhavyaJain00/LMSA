-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "data" JSONB NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meta" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "meta_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "doc" JSONB NOT NULL,
    "position" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "email" TEXT,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "doc" JSONB NOT NULL,
    "position" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "user_id" TEXT,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" TEXT NOT NULL,
    "doc" JSONB NOT NULL,
    "position" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "slug" TEXT,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "courses" (
    "id" TEXT NOT NULL,
    "doc" JSONB NOT NULL,
    "position" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "slug" TEXT,

    CONSTRAINT "courses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chapters" (
    "id" TEXT NOT NULL,
    "doc" JSONB NOT NULL,
    "position" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "course_id" TEXT,

    CONSTRAINT "chapters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lessons" (
    "id" TEXT NOT NULL,
    "doc" JSONB NOT NULL,
    "position" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "course_id" TEXT,
    "slug" TEXT,

    CONSTRAINT "lessons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "questions" (
    "id" TEXT NOT NULL,
    "doc" JSONB NOT NULL,
    "position" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quizzes" (
    "id" TEXT NOT NULL,
    "doc" JSONB NOT NULL,
    "position" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "course_id" TEXT,
    "lesson_id" TEXT,

    CONSTRAINT "quizzes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quiz_submissions" (
    "id" TEXT NOT NULL,
    "doc" JSONB NOT NULL,
    "position" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "user_id" TEXT,
    "course_id" TEXT,
    "lesson_id" TEXT,

    CONSTRAINT "quiz_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quiz_violations" (
    "id" TEXT NOT NULL,
    "doc" JSONB NOT NULL,
    "position" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "user_id" TEXT,

    CONSTRAINT "quiz_violations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assignments" (
    "id" TEXT NOT NULL,
    "doc" JSONB NOT NULL,
    "position" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "course_id" TEXT,

    CONSTRAINT "assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assignment_submissions" (
    "id" TEXT NOT NULL,
    "doc" JSONB NOT NULL,
    "position" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "user_id" TEXT,
    "course_id" TEXT,
    "lesson_id" TEXT,

    CONSTRAINT "assignment_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exercises" (
    "id" TEXT NOT NULL,
    "doc" JSONB NOT NULL,
    "position" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "course_id" TEXT,

    CONSTRAINT "exercises_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exercise_submissions" (
    "id" TEXT NOT NULL,
    "doc" JSONB NOT NULL,
    "position" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "user_id" TEXT,
    "course_id" TEXT,
    "lesson_id" TEXT,

    CONSTRAINT "exercise_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enrollments" (
    "id" TEXT NOT NULL,
    "doc" JSONB NOT NULL,
    "position" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "user_id" TEXT,
    "course_id" TEXT,

    CONSTRAINT "enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "progress" (
    "id" TEXT NOT NULL,
    "doc" JSONB NOT NULL,
    "position" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "user_id" TEXT,
    "course_id" TEXT,
    "lesson_id" TEXT,

    CONSTRAINT "progress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "video_watches" (
    "id" TEXT NOT NULL,
    "doc" JSONB NOT NULL,
    "position" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "user_id" TEXT,
    "course_id" TEXT,
    "lesson_id" TEXT,

    CONSTRAINT "video_watches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notes" (
    "id" TEXT NOT NULL,
    "doc" JSONB NOT NULL,
    "position" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "user_id" TEXT,
    "course_id" TEXT,
    "lesson_id" TEXT,

    CONSTRAINT "notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reviews" (
    "id" TEXT NOT NULL,
    "doc" JSONB NOT NULL,
    "position" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "user_id" TEXT,
    "course_id" TEXT,

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "batches" (
    "id" TEXT NOT NULL,
    "doc" JSONB NOT NULL,
    "position" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "slug" TEXT,

    CONSTRAINT "batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "batch_enrollments" (
    "id" TEXT NOT NULL,
    "doc" JSONB NOT NULL,
    "position" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "user_id" TEXT,

    CONSTRAINT "batch_enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "batch_feedback" (
    "id" TEXT NOT NULL,
    "doc" JSONB NOT NULL,
    "position" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "user_id" TEXT,

    CONSTRAINT "batch_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "live_classes" (
    "id" TEXT NOT NULL,
    "doc" JSONB NOT NULL,
    "position" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "live_classes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "announcements" (
    "id" TEXT NOT NULL,
    "doc" JSONB NOT NULL,
    "position" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "course_id" TEXT,

    CONSTRAINT "announcements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_templates" (
    "id" TEXT NOT NULL,
    "doc" JSONB NOT NULL,
    "position" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "email_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "programs" (
    "id" TEXT NOT NULL,
    "doc" JSONB NOT NULL,
    "position" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "slug" TEXT,

    CONSTRAINT "programs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "program_members" (
    "id" TEXT NOT NULL,
    "doc" JSONB NOT NULL,
    "position" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "user_id" TEXT,

    CONSTRAINT "program_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "certificates" (
    "id" TEXT NOT NULL,
    "doc" JSONB NOT NULL,
    "position" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "user_id" TEXT,
    "course_id" TEXT,

    CONSTRAINT "certificates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "certificate_requests" (
    "id" TEXT NOT NULL,
    "doc" JSONB NOT NULL,
    "position" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "user_id" TEXT,
    "course_id" TEXT,

    CONSTRAINT "certificate_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "certificate_evaluations" (
    "id" TEXT NOT NULL,
    "doc" JSONB NOT NULL,
    "position" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "user_id" TEXT,
    "course_id" TEXT,

    CONSTRAINT "certificate_evaluations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evaluator_slots" (
    "id" TEXT NOT NULL,
    "doc" JSONB NOT NULL,
    "position" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "evaluator_slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "badges" (
    "id" TEXT NOT NULL,
    "doc" JSONB NOT NULL,
    "position" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "badges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "badge_assignments" (
    "id" TEXT NOT NULL,
    "doc" JSONB NOT NULL,
    "position" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "user_id" TEXT,

    CONSTRAINT "badge_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activities" (
    "id" TEXT NOT NULL,
    "doc" JSONB NOT NULL,
    "position" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "user_id" TEXT,

    CONSTRAINT "activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "doc" JSONB NOT NULL,
    "position" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "user_id" TEXT,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discussion_topics" (
    "id" TEXT NOT NULL,
    "doc" JSONB NOT NULL,
    "position" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "course_id" TEXT,

    CONSTRAINT "discussion_topics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discussion_replies" (
    "id" TEXT NOT NULL,
    "doc" JSONB NOT NULL,
    "position" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "discussion_replies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "doc" JSONB NOT NULL,
    "position" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "user_id" TEXT,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coupons" (
    "id" TEXT NOT NULL,
    "doc" JSONB NOT NULL,
    "position" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "coupons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jobs" (
    "id" TEXT NOT NULL,
    "doc" JSONB NOT NULL,
    "position" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "slug" TEXT,

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_applications" (
    "id" TEXT NOT NULL,
    "doc" JSONB NOT NULL,
    "position" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "user_id" TEXT,

    CONSTRAINT "job_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "emails" (
    "id" TEXT NOT NULL,
    "doc" JSONB NOT NULL,
    "position" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "user_id" TEXT,

    CONSTRAINT "emails_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_tokens" (
    "id" TEXT NOT NULL,
    "doc" JSONB NOT NULL,
    "position" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "user_id" TEXT,

    CONSTRAINT "auth_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "login_events" (
    "id" TEXT NOT NULL,
    "doc" JSONB NOT NULL,
    "position" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "user_id" TEXT,
    "email" TEXT,

    CONSTRAINT "login_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "points" (
    "id" TEXT NOT NULL,
    "doc" JSONB NOT NULL,
    "position" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "user_id" TEXT,
    "course_id" TEXT,

    CONSTRAINT "points_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "login_throttles" (
    "id" TEXT NOT NULL,
    "doc" JSONB NOT NULL,
    "position" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "login_throttles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "upload_sessions" (
    "id" TEXT NOT NULL,
    "doc" JSONB NOT NULL,
    "position" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "user_id" TEXT,

    CONSTRAINT "upload_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transcode_jobs" (
    "id" TEXT NOT NULL,
    "doc" JSONB NOT NULL,
    "position" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "lesson_id" TEXT,

    CONSTRAINT "transcode_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transcripts" (
    "id" TEXT NOT NULL,
    "doc" JSONB NOT NULL,
    "position" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "lesson_id" TEXT,

    CONSTRAINT "transcripts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blog_posts" (
    "id" TEXT NOT NULL,
    "doc" JSONB NOT NULL,
    "position" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "slug" TEXT,

    CONSTRAINT "blog_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "slug_redirects" (
    "id" TEXT NOT NULL,
    "doc" JSONB NOT NULL,
    "position" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "slug_redirects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leads" (
    "id" TEXT NOT NULL,
    "doc" JSONB NOT NULL,
    "position" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "course_id" TEXT,
    "email" TEXT,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "legal_pages" (
    "id" TEXT NOT NULL,
    "doc" JSONB NOT NULL,
    "position" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "slug" TEXT,

    CONSTRAINT "legal_pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consents" (
    "id" TEXT NOT NULL,
    "doc" JSONB NOT NULL,
    "position" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "user_id" TEXT,

    CONSTRAINT "consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" TEXT NOT NULL,
    "doc" JSONB NOT NULL,
    "position" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "error_events" (
    "id" TEXT NOT NULL,
    "doc" JSONB NOT NULL,
    "position" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "user_id" TEXT,

    CONSTRAINT "error_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_requests" (
    "id" TEXT NOT NULL,
    "doc" JSONB NOT NULL,
    "position" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "user_id" TEXT,

    CONSTRAINT "data_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_conversations" (
    "id" TEXT NOT NULL,
    "doc" JSONB NOT NULL,
    "position" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "user_id" TEXT,
    "course_id" TEXT,
    "lesson_id" TEXT,

    CONSTRAINT "ai_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_messages" (
    "id" TEXT NOT NULL,
    "doc" JSONB NOT NULL,
    "position" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ai_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_clarifications" (
    "id" TEXT NOT NULL,
    "doc" JSONB NOT NULL,
    "position" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "course_id" TEXT,
    "lesson_id" TEXT,

    CONSTRAINT "ai_clarifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plans" (
    "id" TEXT NOT NULL,
    "doc" JSONB NOT NULL,
    "position" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "slug" TEXT,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" TEXT NOT NULL,
    "doc" JSONB NOT NULL,
    "position" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "user_id" TEXT,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bundles" (
    "id" TEXT NOT NULL,
    "doc" JSONB NOT NULL,
    "position" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "slug" TEXT,

    CONSTRAINT "bundles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gifts" (
    "id" TEXT NOT NULL,
    "doc" JSONB NOT NULL,
    "position" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "gifts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "upsells" (
    "id" TEXT NOT NULL,
    "doc" JSONB NOT NULL,
    "position" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "upsells_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_rules" (
    "id" TEXT NOT NULL,
    "doc" JSONB NOT NULL,
    "position" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tax_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checkout_sessions" (
    "id" TEXT NOT NULL,
    "doc" JSONB NOT NULL,
    "position" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "user_id" TEXT,
    "email" TEXT,

    CONSTRAINT "checkout_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "affiliates" (
    "id" TEXT NOT NULL,
    "doc" JSONB NOT NULL,
    "position" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "user_id" TEXT,

    CONSTRAINT "affiliates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "affiliate_referrals" (
    "id" TEXT NOT NULL,
    "doc" JSONB NOT NULL,
    "position" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "affiliate_referrals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commissions" (
    "id" TEXT NOT NULL,
    "doc" JSONB NOT NULL,
    "position" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "commissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organizations" (
    "id" TEXT NOT NULL,
    "doc" JSONB NOT NULL,
    "position" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "slug" TEXT,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "org_seats" (
    "id" TEXT NOT NULL,
    "doc" JSONB NOT NULL,
    "position" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "user_id" TEXT,
    "email" TEXT,

    CONSTRAINT "org_seats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics_events" (
    "id" TEXT NOT NULL,
    "doc" JSONB NOT NULL,
    "position" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "user_id" TEXT,

    CONSTRAINT "analytics_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "broadcasts" (
    "id" TEXT NOT NULL,
    "doc" JSONB NOT NULL,
    "position" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "broadcasts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_sequences" (
    "id" TEXT NOT NULL,
    "doc" JSONB NOT NULL,
    "position" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "course_id" TEXT,

    CONSTRAINT "email_sequences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sequence_enrollments" (
    "id" TEXT NOT NULL,
    "doc" JSONB NOT NULL,
    "position" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "user_id" TEXT,
    "course_id" TEXT,
    "email" TEXT,

    CONSTRAINT "sequence_enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_events" (
    "id" TEXT NOT NULL,
    "doc" JSONB NOT NULL,
    "position" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "email_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" TEXT NOT NULL,
    "doc" JSONB NOT NULL,
    "position" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "course_id" TEXT,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "direct_messages" (
    "id" TEXT NOT NULL,
    "doc" JSONB NOT NULL,
    "position" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "direct_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_keys" (
    "id" TEXT NOT NULL,
    "doc" JSONB NOT NULL,
    "position" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_endpoints" (
    "id" TEXT NOT NULL,
    "doc" JSONB NOT NULL,
    "position" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "webhook_endpoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_deliveries" (
    "id" TEXT NOT NULL,
    "doc" JSONB NOT NULL,
    "position" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rubrics" (
    "id" TEXT NOT NULL,
    "doc" JSONB NOT NULL,
    "position" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "rubrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "peer_reviews" (
    "id" TEXT NOT NULL,
    "doc" JSONB NOT NULL,
    "position" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "peer_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lesson_versions" (
    "id" TEXT NOT NULL,
    "doc" JSONB NOT NULL,
    "position" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "lesson_id" TEXT,

    CONSTRAINT "lesson_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "instructor_profiles" (
    "id" TEXT NOT NULL,
    "doc" JSONB NOT NULL,
    "position" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "user_id" TEXT,

    CONSTRAINT "instructor_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "earnings" (
    "id" TEXT NOT NULL,
    "doc" JSONB NOT NULL,
    "position" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "course_id" TEXT,

    CONSTRAINT "earnings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payouts" (
    "id" TEXT NOT NULL,
    "doc" JSONB NOT NULL,
    "position" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payouts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "users_position_id_idx" ON "users"("position", "id");

-- CreateIndex
CREATE INDEX "users_email_idx" ON "users"("email");

-- CreateIndex
CREATE INDEX "sessions_position_id_idx" ON "sessions"("position", "id");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "categories_position_id_idx" ON "categories"("position", "id");

-- CreateIndex
CREATE INDEX "categories_slug_idx" ON "categories"("slug");

-- CreateIndex
CREATE INDEX "courses_position_id_idx" ON "courses"("position", "id");

-- CreateIndex
CREATE INDEX "courses_slug_idx" ON "courses"("slug");

-- CreateIndex
CREATE INDEX "chapters_position_id_idx" ON "chapters"("position", "id");

-- CreateIndex
CREATE INDEX "chapters_course_id_idx" ON "chapters"("course_id");

-- CreateIndex
CREATE INDEX "lessons_position_id_idx" ON "lessons"("position", "id");

-- CreateIndex
CREATE INDEX "lessons_course_id_idx" ON "lessons"("course_id");

-- CreateIndex
CREATE INDEX "lessons_slug_idx" ON "lessons"("slug");

-- CreateIndex
CREATE INDEX "questions_position_id_idx" ON "questions"("position", "id");

-- CreateIndex
CREATE INDEX "quizzes_position_id_idx" ON "quizzes"("position", "id");

-- CreateIndex
CREATE INDEX "quizzes_course_id_idx" ON "quizzes"("course_id");

-- CreateIndex
CREATE INDEX "quizzes_lesson_id_idx" ON "quizzes"("lesson_id");

-- CreateIndex
CREATE INDEX "quiz_submissions_position_id_idx" ON "quiz_submissions"("position", "id");

-- CreateIndex
CREATE INDEX "quiz_submissions_user_id_idx" ON "quiz_submissions"("user_id");

-- CreateIndex
CREATE INDEX "quiz_submissions_course_id_idx" ON "quiz_submissions"("course_id");

-- CreateIndex
CREATE INDEX "quiz_submissions_lesson_id_idx" ON "quiz_submissions"("lesson_id");

-- CreateIndex
CREATE INDEX "quiz_violations_position_id_idx" ON "quiz_violations"("position", "id");

-- CreateIndex
CREATE INDEX "quiz_violations_user_id_idx" ON "quiz_violations"("user_id");

-- CreateIndex
CREATE INDEX "assignments_position_id_idx" ON "assignments"("position", "id");

-- CreateIndex
CREATE INDEX "assignments_course_id_idx" ON "assignments"("course_id");

-- CreateIndex
CREATE INDEX "assignment_submissions_position_id_idx" ON "assignment_submissions"("position", "id");

-- CreateIndex
CREATE INDEX "assignment_submissions_user_id_idx" ON "assignment_submissions"("user_id");

-- CreateIndex
CREATE INDEX "assignment_submissions_course_id_idx" ON "assignment_submissions"("course_id");

-- CreateIndex
CREATE INDEX "assignment_submissions_lesson_id_idx" ON "assignment_submissions"("lesson_id");

-- CreateIndex
CREATE INDEX "exercises_position_id_idx" ON "exercises"("position", "id");

-- CreateIndex
CREATE INDEX "exercises_course_id_idx" ON "exercises"("course_id");

-- CreateIndex
CREATE INDEX "exercise_submissions_position_id_idx" ON "exercise_submissions"("position", "id");

-- CreateIndex
CREATE INDEX "exercise_submissions_user_id_idx" ON "exercise_submissions"("user_id");

-- CreateIndex
CREATE INDEX "exercise_submissions_course_id_idx" ON "exercise_submissions"("course_id");

-- CreateIndex
CREATE INDEX "exercise_submissions_lesson_id_idx" ON "exercise_submissions"("lesson_id");

-- CreateIndex
CREATE INDEX "enrollments_position_id_idx" ON "enrollments"("position", "id");

-- CreateIndex
CREATE INDEX "enrollments_user_id_idx" ON "enrollments"("user_id");

-- CreateIndex
CREATE INDEX "enrollments_course_id_idx" ON "enrollments"("course_id");

-- CreateIndex
CREATE INDEX "progress_position_id_idx" ON "progress"("position", "id");

-- CreateIndex
CREATE INDEX "progress_user_id_idx" ON "progress"("user_id");

-- CreateIndex
CREATE INDEX "progress_course_id_idx" ON "progress"("course_id");

-- CreateIndex
CREATE INDEX "progress_lesson_id_idx" ON "progress"("lesson_id");

-- CreateIndex
CREATE INDEX "video_watches_position_id_idx" ON "video_watches"("position", "id");

-- CreateIndex
CREATE INDEX "video_watches_user_id_idx" ON "video_watches"("user_id");

-- CreateIndex
CREATE INDEX "video_watches_course_id_idx" ON "video_watches"("course_id");

-- CreateIndex
CREATE INDEX "video_watches_lesson_id_idx" ON "video_watches"("lesson_id");

-- CreateIndex
CREATE INDEX "notes_position_id_idx" ON "notes"("position", "id");

-- CreateIndex
CREATE INDEX "notes_user_id_idx" ON "notes"("user_id");

-- CreateIndex
CREATE INDEX "notes_course_id_idx" ON "notes"("course_id");

-- CreateIndex
CREATE INDEX "notes_lesson_id_idx" ON "notes"("lesson_id");

-- CreateIndex
CREATE INDEX "reviews_position_id_idx" ON "reviews"("position", "id");

-- CreateIndex
CREATE INDEX "reviews_user_id_idx" ON "reviews"("user_id");

-- CreateIndex
CREATE INDEX "reviews_course_id_idx" ON "reviews"("course_id");

-- CreateIndex
CREATE INDEX "batches_position_id_idx" ON "batches"("position", "id");

-- CreateIndex
CREATE INDEX "batches_slug_idx" ON "batches"("slug");

-- CreateIndex
CREATE INDEX "batch_enrollments_position_id_idx" ON "batch_enrollments"("position", "id");

-- CreateIndex
CREATE INDEX "batch_enrollments_user_id_idx" ON "batch_enrollments"("user_id");

-- CreateIndex
CREATE INDEX "batch_feedback_position_id_idx" ON "batch_feedback"("position", "id");

-- CreateIndex
CREATE INDEX "batch_feedback_user_id_idx" ON "batch_feedback"("user_id");

-- CreateIndex
CREATE INDEX "live_classes_position_id_idx" ON "live_classes"("position", "id");

-- CreateIndex
CREATE INDEX "announcements_position_id_idx" ON "announcements"("position", "id");

-- CreateIndex
CREATE INDEX "announcements_course_id_idx" ON "announcements"("course_id");

-- CreateIndex
CREATE INDEX "email_templates_position_id_idx" ON "email_templates"("position", "id");

-- CreateIndex
CREATE INDEX "programs_position_id_idx" ON "programs"("position", "id");

-- CreateIndex
CREATE INDEX "programs_slug_idx" ON "programs"("slug");

-- CreateIndex
CREATE INDEX "program_members_position_id_idx" ON "program_members"("position", "id");

-- CreateIndex
CREATE INDEX "program_members_user_id_idx" ON "program_members"("user_id");

-- CreateIndex
CREATE INDEX "certificates_position_id_idx" ON "certificates"("position", "id");

-- CreateIndex
CREATE INDEX "certificates_user_id_idx" ON "certificates"("user_id");

-- CreateIndex
CREATE INDEX "certificates_course_id_idx" ON "certificates"("course_id");

-- CreateIndex
CREATE INDEX "certificate_requests_position_id_idx" ON "certificate_requests"("position", "id");

-- CreateIndex
CREATE INDEX "certificate_requests_user_id_idx" ON "certificate_requests"("user_id");

-- CreateIndex
CREATE INDEX "certificate_requests_course_id_idx" ON "certificate_requests"("course_id");

-- CreateIndex
CREATE INDEX "certificate_evaluations_position_id_idx" ON "certificate_evaluations"("position", "id");

-- CreateIndex
CREATE INDEX "certificate_evaluations_user_id_idx" ON "certificate_evaluations"("user_id");

-- CreateIndex
CREATE INDEX "certificate_evaluations_course_id_idx" ON "certificate_evaluations"("course_id");

-- CreateIndex
CREATE INDEX "evaluator_slots_position_id_idx" ON "evaluator_slots"("position", "id");

-- CreateIndex
CREATE INDEX "badges_position_id_idx" ON "badges"("position", "id");

-- CreateIndex
CREATE INDEX "badge_assignments_position_id_idx" ON "badge_assignments"("position", "id");

-- CreateIndex
CREATE INDEX "badge_assignments_user_id_idx" ON "badge_assignments"("user_id");

-- CreateIndex
CREATE INDEX "activities_position_id_idx" ON "activities"("position", "id");

-- CreateIndex
CREATE INDEX "activities_user_id_idx" ON "activities"("user_id");

-- CreateIndex
CREATE INDEX "notifications_position_id_idx" ON "notifications"("position", "id");

-- CreateIndex
CREATE INDEX "notifications_user_id_idx" ON "notifications"("user_id");

-- CreateIndex
CREATE INDEX "discussion_topics_position_id_idx" ON "discussion_topics"("position", "id");

-- CreateIndex
CREATE INDEX "discussion_topics_course_id_idx" ON "discussion_topics"("course_id");

-- CreateIndex
CREATE INDEX "discussion_replies_position_id_idx" ON "discussion_replies"("position", "id");

-- CreateIndex
CREATE INDEX "payments_position_id_idx" ON "payments"("position", "id");

-- CreateIndex
CREATE INDEX "payments_user_id_idx" ON "payments"("user_id");

-- CreateIndex
CREATE INDEX "coupons_position_id_idx" ON "coupons"("position", "id");

-- CreateIndex
CREATE INDEX "jobs_position_id_idx" ON "jobs"("position", "id");

-- CreateIndex
CREATE INDEX "jobs_slug_idx" ON "jobs"("slug");

-- CreateIndex
CREATE INDEX "job_applications_position_id_idx" ON "job_applications"("position", "id");

-- CreateIndex
CREATE INDEX "job_applications_user_id_idx" ON "job_applications"("user_id");

-- CreateIndex
CREATE INDEX "emails_position_id_idx" ON "emails"("position", "id");

-- CreateIndex
CREATE INDEX "emails_user_id_idx" ON "emails"("user_id");

-- CreateIndex
CREATE INDEX "auth_tokens_position_id_idx" ON "auth_tokens"("position", "id");

-- CreateIndex
CREATE INDEX "auth_tokens_user_id_idx" ON "auth_tokens"("user_id");

-- CreateIndex
CREATE INDEX "login_events_position_id_idx" ON "login_events"("position", "id");

-- CreateIndex
CREATE INDEX "login_events_user_id_idx" ON "login_events"("user_id");

-- CreateIndex
CREATE INDEX "login_events_email_idx" ON "login_events"("email");

-- CreateIndex
CREATE INDEX "points_position_id_idx" ON "points"("position", "id");

-- CreateIndex
CREATE INDEX "points_user_id_idx" ON "points"("user_id");

-- CreateIndex
CREATE INDEX "points_course_id_idx" ON "points"("course_id");

-- CreateIndex
CREATE INDEX "login_throttles_position_id_idx" ON "login_throttles"("position", "id");

-- CreateIndex
CREATE INDEX "upload_sessions_position_id_idx" ON "upload_sessions"("position", "id");

-- CreateIndex
CREATE INDEX "upload_sessions_user_id_idx" ON "upload_sessions"("user_id");

-- CreateIndex
CREATE INDEX "transcode_jobs_position_id_idx" ON "transcode_jobs"("position", "id");

-- CreateIndex
CREATE INDEX "transcode_jobs_lesson_id_idx" ON "transcode_jobs"("lesson_id");

-- CreateIndex
CREATE INDEX "transcripts_position_id_idx" ON "transcripts"("position", "id");

-- CreateIndex
CREATE INDEX "transcripts_lesson_id_idx" ON "transcripts"("lesson_id");

-- CreateIndex
CREATE INDEX "blog_posts_position_id_idx" ON "blog_posts"("position", "id");

-- CreateIndex
CREATE INDEX "blog_posts_slug_idx" ON "blog_posts"("slug");

-- CreateIndex
CREATE INDEX "slug_redirects_position_id_idx" ON "slug_redirects"("position", "id");

-- CreateIndex
CREATE INDEX "leads_position_id_idx" ON "leads"("position", "id");

-- CreateIndex
CREATE INDEX "leads_course_id_idx" ON "leads"("course_id");

-- CreateIndex
CREATE INDEX "leads_email_idx" ON "leads"("email");

-- CreateIndex
CREATE INDEX "legal_pages_position_id_idx" ON "legal_pages"("position", "id");

-- CreateIndex
CREATE INDEX "legal_pages_slug_idx" ON "legal_pages"("slug");

-- CreateIndex
CREATE INDEX "consents_position_id_idx" ON "consents"("position", "id");

-- CreateIndex
CREATE INDEX "consents_user_id_idx" ON "consents"("user_id");

-- CreateIndex
CREATE INDEX "audit_events_position_id_idx" ON "audit_events"("position", "id");

-- CreateIndex
CREATE INDEX "error_events_position_id_idx" ON "error_events"("position", "id");

-- CreateIndex
CREATE INDEX "error_events_user_id_idx" ON "error_events"("user_id");

-- CreateIndex
CREATE INDEX "data_requests_position_id_idx" ON "data_requests"("position", "id");

-- CreateIndex
CREATE INDEX "data_requests_user_id_idx" ON "data_requests"("user_id");

-- CreateIndex
CREATE INDEX "ai_conversations_position_id_idx" ON "ai_conversations"("position", "id");

-- CreateIndex
CREATE INDEX "ai_conversations_user_id_idx" ON "ai_conversations"("user_id");

-- CreateIndex
CREATE INDEX "ai_conversations_course_id_idx" ON "ai_conversations"("course_id");

-- CreateIndex
CREATE INDEX "ai_conversations_lesson_id_idx" ON "ai_conversations"("lesson_id");

-- CreateIndex
CREATE INDEX "ai_messages_position_id_idx" ON "ai_messages"("position", "id");

-- CreateIndex
CREATE INDEX "ai_clarifications_position_id_idx" ON "ai_clarifications"("position", "id");

-- CreateIndex
CREATE INDEX "ai_clarifications_course_id_idx" ON "ai_clarifications"("course_id");

-- CreateIndex
CREATE INDEX "ai_clarifications_lesson_id_idx" ON "ai_clarifications"("lesson_id");

-- CreateIndex
CREATE INDEX "plans_position_id_idx" ON "plans"("position", "id");

-- CreateIndex
CREATE INDEX "plans_slug_idx" ON "plans"("slug");

-- CreateIndex
CREATE INDEX "subscriptions_position_id_idx" ON "subscriptions"("position", "id");

-- CreateIndex
CREATE INDEX "subscriptions_user_id_idx" ON "subscriptions"("user_id");

-- CreateIndex
CREATE INDEX "bundles_position_id_idx" ON "bundles"("position", "id");

-- CreateIndex
CREATE INDEX "bundles_slug_idx" ON "bundles"("slug");

-- CreateIndex
CREATE INDEX "gifts_position_id_idx" ON "gifts"("position", "id");

-- CreateIndex
CREATE INDEX "upsells_position_id_idx" ON "upsells"("position", "id");

-- CreateIndex
CREATE INDEX "tax_rules_position_id_idx" ON "tax_rules"("position", "id");

-- CreateIndex
CREATE INDEX "checkout_sessions_position_id_idx" ON "checkout_sessions"("position", "id");

-- CreateIndex
CREATE INDEX "checkout_sessions_user_id_idx" ON "checkout_sessions"("user_id");

-- CreateIndex
CREATE INDEX "checkout_sessions_email_idx" ON "checkout_sessions"("email");

-- CreateIndex
CREATE INDEX "affiliates_position_id_idx" ON "affiliates"("position", "id");

-- CreateIndex
CREATE INDEX "affiliates_user_id_idx" ON "affiliates"("user_id");

-- CreateIndex
CREATE INDEX "affiliate_referrals_position_id_idx" ON "affiliate_referrals"("position", "id");

-- CreateIndex
CREATE INDEX "commissions_position_id_idx" ON "commissions"("position", "id");

-- CreateIndex
CREATE INDEX "organizations_position_id_idx" ON "organizations"("position", "id");

-- CreateIndex
CREATE INDEX "organizations_slug_idx" ON "organizations"("slug");

-- CreateIndex
CREATE INDEX "org_seats_position_id_idx" ON "org_seats"("position", "id");

-- CreateIndex
CREATE INDEX "org_seats_user_id_idx" ON "org_seats"("user_id");

-- CreateIndex
CREATE INDEX "org_seats_email_idx" ON "org_seats"("email");

-- CreateIndex
CREATE INDEX "analytics_events_position_id_idx" ON "analytics_events"("position", "id");

-- CreateIndex
CREATE INDEX "analytics_events_user_id_idx" ON "analytics_events"("user_id");

-- CreateIndex
CREATE INDEX "broadcasts_position_id_idx" ON "broadcasts"("position", "id");

-- CreateIndex
CREATE INDEX "email_sequences_position_id_idx" ON "email_sequences"("position", "id");

-- CreateIndex
CREATE INDEX "email_sequences_course_id_idx" ON "email_sequences"("course_id");

-- CreateIndex
CREATE INDEX "sequence_enrollments_position_id_idx" ON "sequence_enrollments"("position", "id");

-- CreateIndex
CREATE INDEX "sequence_enrollments_user_id_idx" ON "sequence_enrollments"("user_id");

-- CreateIndex
CREATE INDEX "sequence_enrollments_course_id_idx" ON "sequence_enrollments"("course_id");

-- CreateIndex
CREATE INDEX "sequence_enrollments_email_idx" ON "sequence_enrollments"("email");

-- CreateIndex
CREATE INDEX "email_events_position_id_idx" ON "email_events"("position", "id");

-- CreateIndex
CREATE INDEX "conversations_position_id_idx" ON "conversations"("position", "id");

-- CreateIndex
CREATE INDEX "conversations_course_id_idx" ON "conversations"("course_id");

-- CreateIndex
CREATE INDEX "direct_messages_position_id_idx" ON "direct_messages"("position", "id");

-- CreateIndex
CREATE INDEX "api_keys_position_id_idx" ON "api_keys"("position", "id");

-- CreateIndex
CREATE INDEX "webhook_endpoints_position_id_idx" ON "webhook_endpoints"("position", "id");

-- CreateIndex
CREATE INDEX "webhook_deliveries_position_id_idx" ON "webhook_deliveries"("position", "id");

-- CreateIndex
CREATE INDEX "rubrics_position_id_idx" ON "rubrics"("position", "id");

-- CreateIndex
CREATE INDEX "peer_reviews_position_id_idx" ON "peer_reviews"("position", "id");

-- CreateIndex
CREATE INDEX "lesson_versions_position_id_idx" ON "lesson_versions"("position", "id");

-- CreateIndex
CREATE INDEX "lesson_versions_lesson_id_idx" ON "lesson_versions"("lesson_id");

-- CreateIndex
CREATE INDEX "instructor_profiles_position_id_idx" ON "instructor_profiles"("position", "id");

-- CreateIndex
CREATE INDEX "instructor_profiles_user_id_idx" ON "instructor_profiles"("user_id");

-- CreateIndex
CREATE INDEX "earnings_position_id_idx" ON "earnings"("position", "id");

-- CreateIndex
CREATE INDEX "earnings_course_id_idx" ON "earnings"("course_id");

-- CreateIndex
CREATE INDEX "payouts_position_id_idx" ON "payouts"("position", "id");

