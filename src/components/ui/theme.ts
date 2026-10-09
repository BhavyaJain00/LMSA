/**
 * Colour theme constants shared by the pre-paint script (root layout), the theme switches and the
 * profile preference. Plain module (no "use client"), so server components and tests can import it.
 */

export type Theme = "light" | "dark";

/** localStorage key holding "light", "dark" or "system" (nothing saved = the default theme). */
export const THEME_STORAGE_KEY = "ll-theme";

/** Theme for visitors who never chose one. */
export const DEFAULT_THEME: Theme = "dark";

/**
 * Inline script that applies the saved theme before first paint (avoids a flash). Nothing saved means the
 * default (dark); a saved "system" follows the operating system.
 */
export const themeInitScript = `(function(){var t="${DEFAULT_THEME}";try{var s=localStorage.getItem("${THEME_STORAGE_KEY}");if(s==="light"||s==="dark"){t=s}else if(s==="system"){t=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}}catch(e){}document.documentElement.setAttribute("data-theme",t)})();`;
