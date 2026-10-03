/**
 * Validation and sanitization helpers for user inputs.
 */

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Validates whether a string is a standard email address format.
 */
export function isValidEmail(email: string): boolean {
  if (typeof email !== "string") return false;
  return EMAIL_REGEX.test(email.trim().toLowerCase());
}

/**
 * Validates whether a string is an HTTP or HTTPS URL.
 */
export function isValidUrl(url: string): boolean {
  if (typeof url !== "string") return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Validates whether a string is a valid URL slug (lowercase alphanumeric with hyphens).
 */
export function isValidSlug(slug: string): boolean {
  if (typeof slug !== "string") return false;
  return SLUG_REGEX.test(slug);
}

/**
 * Checks password strength according to minimum security guidelines.
 */
export function isStrongPassword(password: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!password || password.length < 8) {
    errors.push("Password must be at least 8 characters long.");
  }
  if (!/[A-Z]/.test(password)) {
    errors.push("Password must contain at least one uppercase letter.");
  }
  if (!/[a-z]/.test(password)) {
    errors.push("Password must contain at least one lowercase letter.");
  }
  if (!/[0-9]/.test(password)) {
    errors.push("Password must contain at least one number.");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Strips HTML control tags and trims whitespace from a text string.
 */
export function sanitizeInput(text: string): string {
  if (typeof text !== "string") return "";
  return text
    .replace(/<[^>]*>/g, "")
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, "")
    .trim();
}
