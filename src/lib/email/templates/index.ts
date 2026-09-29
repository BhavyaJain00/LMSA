/**
 * Email templates. Every template is a pure function
 * `(brand, data) => { subject, html, text }` built on the shared layout, so
 * they can be previewed and tested without a database.
 */
export * from "./layout";
export { welcomeEmail, type WelcomeEmailData } from "./welcome";
export { passwordResetEmail, formatLifetime, type PasswordResetEmailData } from "./password-reset";
export { emailVerificationEmail, type EmailVerificationData } from "./email-verification";
export { enrollmentConfirmationEmail, type EnrollmentEmailData, type EnrollmentKind } from "./enrollment";
export { announcementEmail, type AnnouncementEmailData } from "./announcement";
export { batchMessageEmail, type BatchMessageEmailData } from "./batch-message";
export { liveClassEmail, type LiveClassEmailData, type LiveClassEmailVariant } from "./live-class";
export { gradedEmail, type GradedEmailData, type GradedOutcome } from "./graded";
export { certificateIssuedEmail, type CertificateEmailData } from "./certificate";
export {
  paymentReceiptEmail,
  paymentReminderEmail,
  paymentRefundEmail,
  type PaymentReceiptData,
  type PaymentReminderData,
  type PaymentRefundData,
} from "./payment";
export { notificationEmail, type NotificationEmailData } from "./notification";
export { testEmail, type TestEmailData } from "./test";
