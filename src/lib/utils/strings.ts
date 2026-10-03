/**
 * String manipulation and content analysis helpers.
 */

/**
 * Truncates a string to a given length and appends a suffix if truncated.
 */
export function truncate(str: string, maxLength: number, suffix = "..."): string {
  if (!str || str.length <= maxLength) return str || "";
  const sub = str.slice(0, Math.max(0, maxLength - suffix.length));
  return `${sub}${suffix}`;
}

/**
 * Capitalizes the first letter of a string.
 */
export function capitalize(str: string): string {
  if (!str) return "";
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Converts words in a string to Title Case.
 */
export function titleCase(str: string): string {
  if (!str) return "";
  return str
    .toLowerCase()
    .split(/\s+/)
    .map((word) => (word ? word.charAt(0).toUpperCase() + word.slice(1) : ""))
    .join(" ");
}

/**
 * Counts the number of words in a text string.
 */
export function wordCount(str: string): number {
  if (!str || !str.trim()) return 0;
  return str.trim().split(/\s+/).length;
}

/**
 * Estimates reading time in minutes based on average reading speed.
 */
export function readingTimeMinutes(str: string, wordsPerMinute = 200): number {
  const count = wordCount(str);
  if (count === 0) return 0;
  return Math.max(1, Math.ceil(count / wordsPerMinute));
}
