/**
 * Password policy and strength estimation (pure — shared by Server Actions and
 * the client-side strength meter).
 *
 * Policy (enforced on the server): at least `settings.security.passwordMinLength`
 * characters (8–64), at most 256, and it must contain letters and numbers.
 *
 * Strength (advisory, shown while typing): an entropy estimate from length and
 * character variety, discounted for repeats, keyboard/alphabet runs, common
 * passwords and personal details such as the email name.
 */

export const PASSWORD_MIN_LENGTH_FLOOR = 8;
export const PASSWORD_MIN_LENGTH_CEILING = 64;
/** Upper bound keeps hashing cost predictable. */
export const PASSWORD_MAX_LENGTH = 256;

/** Clamp a configured minimum length into the supported 8–64 range. */
export function clampMinLength(value: number | undefined | null): number {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return PASSWORD_MIN_LENGTH_FLOOR;
  return Math.min(PASSWORD_MIN_LENGTH_CEILING, Math.max(PASSWORD_MIN_LENGTH_FLOOR, n));
}

const HAS_LETTER = /\p{L}/u;
const HAS_DIGIT = /\p{Nd}/u;

export interface PasswordRequirement {
  id: "length" | "letters" | "numbers";
  label: string;
  met: boolean;
}

/** The individual rules, for checklists in the UI. */
export function passwordRequirements(password: string, minLength = PASSWORD_MIN_LENGTH_FLOOR): PasswordRequirement[] {
  const min = clampMinLength(minLength);
  return [
    { id: "length", label: `At least ${min} characters`, met: [...password].length >= min },
    { id: "letters", label: "Contains a letter", met: HAS_LETTER.test(password) },
    { id: "numbers", label: "Contains a number", met: HAS_DIGIT.test(password) },
  ];
}

/** Returns an error message when the password breaks the policy, otherwise null. */
export function checkPasswordPolicy(password: string, minLength = PASSWORD_MIN_LENGTH_FLOOR): string | null {
  const min = clampMinLength(minLength);
  const length = [...password].length;
  if (length < min) return `Password must be at least ${min} characters.`;
  if (password.length > PASSWORD_MAX_LENGTH) return `Password must be at most ${PASSWORD_MAX_LENGTH} characters.`;
  if (!HAS_LETTER.test(password) || !HAS_DIGIT.test(password)) return "Password must contain letters and numbers.";
  return null;
}

/* ------------------------------------------------------------------ */
/* Strength estimation                                                  */
/* ------------------------------------------------------------------ */

export type PasswordStrengthScore = 0 | 1 | 2 | 3 | 4;

export interface PasswordStrength {
  score: PasswordStrengthScore;
  label: "Too weak" | "Weak" | "Fair" | "Good" | "Strong";
  /** Rough entropy estimate in bits. */
  bits: number;
  /** Whether the password satisfies the server policy. */
  meetsPolicy: boolean;
  /** Short, actionable suggestions (at most two). */
  suggestions: string[];
}

const LABELS: PasswordStrength["label"][] = ["Too weak", "Weak", "Fair", "Good", "Strong"];

/** Frequently breached passwords and fragments (lower-case, compared after stripping digits/symbols). */
const COMMON = new Set([
  "password",
  "passw0rd",
  "letmein",
  "welcome",
  "qwerty",
  "qwertyuiop",
  "asdfgh",
  "asdfghjkl",
  "zxcvbnm",
  "iloveyou",
  "admin",
  "administrator",
  "monkey",
  "dragon",
  "football",
  "baseball",
  "master",
  "sunshine",
  "princess",
  "shadow",
  "superman",
  "trustno",
  "abc",
  "abcdef",
  "abcdefg",
  "login",
  "secret",
  "changeme",
  "starwars",
  "whatever",
  "hello",
  "freedom",
  "computer",
  "michael",
  "jennifer",
  "summer",
  "winter",
  "spring",
  "autumn",
  "learnloop",
  "student",
  "teacher",
  "school",
]);

const SEQUENCES = ["abcdefghijklmnopqrstuvwxyz", "qwertyuiopasdfghjklzxcvbnm", "01234567890", "1qaz2wsx3edc4rfv5tgb"];

function poolSize(password: string): number {
  let pool = 0;
  if (/[a-z]/.test(password)) pool += 26;
  if (/[A-Z]/.test(password)) pool += 26;
  if (/[0-9]/.test(password)) pool += 10;
  if (/[ -/:-@[-`{-~]/.test(password)) pool += 33;
  if (/[^\p{ASCII}]/u.test(password)) pool += 100;
  return Math.max(pool, 1);
}

/** Characters that add little information: repeats ("aaa") and runs ("abcd", "4321", "qwer"). */
function predictableChars(password: string): number {
  const lower = password.toLowerCase();
  let predictable = 0;
  for (let i = 1; i < lower.length; i++) {
    const prev = lower[i - 1]!;
    const ch = lower[i]!;
    if (ch === prev) {
      predictable++;
      continue;
    }
    const pair = prev + ch;
    const reversed = ch + prev;
    if (SEQUENCES.some((s) => s.includes(pair) || s.includes(reversed))) predictable++;
  }
  return predictable;
}

function containsCommonWord(password: string): boolean {
  const letters = password
    .toLowerCase()
    .replace(/[0@]/g, (c) => (c === "0" ? "o" : "a"))
    .replace(/[1!]/g, "i")
    .replace(/3/g, "e")
    .replace(/[5$]/g, "s")
    .replace(/[^a-z]/g, "");
  if (!letters) return false;
  if (COMMON.has(letters)) return true;
  for (const word of COMMON) if (word.length >= 5 && letters.includes(word)) return true;
  return false;
}

/**
 * Estimate how hard a password is to guess. `context` holds personal words
 * (name, email local part, brand) that should not appear in it.
 */
export function passwordStrength(password: string, minLength = PASSWORD_MIN_LENGTH_FLOOR, context: string[] = []): PasswordStrength {
  const meetsPolicy = checkPasswordPolicy(password, minLength) === null;
  if (!password) return { score: 0, label: LABELS[0]!, bits: 0, meetsPolicy, suggestions: [] };

  const chars = [...password];
  const effectiveLength = Math.max(1, chars.length - predictableChars(password) * 0.75);
  let bits = effectiveLength * Math.log2(poolSize(password));

  const suggestions: string[] = [];
  const lower = password.toLowerCase();
  const personal = context.flatMap((c) => c.toLowerCase().split(/[^\p{L}\p{N}]+/u)).filter((w) => w.length >= 3);
  const hasPersonal = personal.some((w) => lower.includes(w));
  const hasCommon = containsCommonWord(password);

  if (hasCommon) {
    bits = Math.min(bits, 24);
    suggestions.push("Avoid common passwords and predictable words.");
  }
  if (hasPersonal) {
    bits = Math.min(bits, 28);
    suggestions.push("Don't include your name or email.");
  }
  if (predictableChars(password) >= Math.max(3, chars.length / 3)) suggestions.push("Avoid repeated characters and sequences like “abc” or “123”.");
  if (chars.length < 12) suggestions.push("Longer is stronger — try a passphrase of three or four words.");
  if (poolSize(password) < 40 && chars.length < 16) suggestions.push("Mix in capitals or symbols.");

  let score: PasswordStrengthScore = bits < 28 ? 0 : bits < 40 ? 1 : bits < 60 ? 2 : bits < 80 ? 3 : 4;
  if (!meetsPolicy && score > 1) score = 1;

  return { score, label: LABELS[score]!, bits: Math.round(bits), meetsPolicy, suggestions: suggestions.slice(0, 2) };
}
