import "server-only";

/**
 * Public email API used across the app.
 *
 *  - `enqueueEmail(input)` stores a message in the `emails` outbox and
 *    triggers a background delivery attempt (SMTP or log transport, retries
 *    with backoff). Its signature is stable: account-security, batches and
 *    payments call it directly. HTML fragments are wrapped in the branded
 *    layout automatically; pass `text` to control the plain-text part.
 *  - Ready-made senders (`sendPasswordResetEmail`, `sendWelcomeEmail`, …)
 *    render the branded templates and apply the email rules.
 *  - `emailNotifications` (used by `notify`/`notifyMany`) sends email copies
 *    of in-app notifications according to Settings → Email and each member's
 *    email preferences.
 */
export {
  enqueueEmail,
  enqueueEmails,
  deliverDueEmails,
  deliverEmailNow,
  scheduleDelivery,
  getDeliveryState,
  getOutboxCounts,
  retryEmail,
  resendEmail,
  deleteEmail,
  retryAllFailed,
  pruneOutbox,
  redactForView,
  isSensitiveCategory,
  MAX_ATTEMPTS,
  RETRY_DELAYS_MS,
  DEFAULT_RUN_LIMIT,
  type EnqueueEmailInput,
  type EnqueueOptions,
  type DeliveryRunResult,
  type DeliveryState,
  type OutboxCounts,
  type OutboxOpResult,
} from "./outbox";
export { htmlToText, escapeHtml } from "./html";
export { markdownToEmailHtml, markdownToText, escapeMarkdown } from "./markdown";
export { brandFromSettings, getEmailBrand } from "./context";
export { getTransportStatus, verifySmtpConnection, resolveSender, type TransportStatus, type SenderIdentity } from "./transport";
export { unsubscribeUrl, preferencesUrl, verifyUnsubscribeToken, isUnsubscribeScope, cronKey, cronUrl, verifyCronKey, type UnsubscribeScope } from "./signing";
export { emailNotifications } from "./notifications";
export {
  sendBatchAnnouncementEmails,
  sendCourseAnnouncementEmails,
  sendBatchMessage,
  sendBatchConfirmationEmail,
  batchAudienceText,
  courseAudienceText,
  fillPlaceholders,
  BATCH_PLACEHOLDERS,
  COURSE_PLACEHOLDERS,
  type BulkEmailResult,
  type BatchMessageInput,
  type BatchMessageResult,
} from "./batch";
export {
  sendWelcomeEmail,
  sendPasswordResetEmail,
  sendEmailVerificationEmail,
  sendCourseEnrollmentEmail,
  sendCertificateIssuedEmail,
  sendLiveClassReminderEmails,
  sendPaymentReceiptEmail,
  sendPaymentReminderEmail,
  sendTestEmail,
} from "./send";
