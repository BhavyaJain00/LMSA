/**
 * Tiny user-agent summariser for session and login-history lists
 * ("Chrome on Windows", "Safari on iOS"). Pure; no external database.
 */

export type DeviceKind = "desktop" | "mobile" | "tablet" | "bot" | "unknown";

export interface UserAgentSummary {
  browser: string;
  os: string;
  /** "Chrome on Windows" */
  label: string;
  kind: DeviceKind;
}

function detectBrowser(ua: string): string {
  if (/bot|crawler|spider|crawling|headless/i.test(ua)) return "Bot";
  if (/Edg(e|A|iOS)?\//.test(ua)) return "Edge";
  if (/OPR\/|Opera/.test(ua)) return "Opera";
  if (/SamsungBrowser\//.test(ua)) return "Samsung Internet";
  if (/Firefox\/|FxiOS\//.test(ua)) return "Firefox";
  if (/CriOS\//.test(ua)) return "Chrome";
  if (/Chrome\/|Chromium\//.test(ua)) return "Chrome";
  if (/Safari\//.test(ua) && /Version\//.test(ua)) return "Safari";
  if (/curl|wget|node|undici|python|okhttp|axios|go-http-client|postman/i.test(ua)) return "Script";
  return "Browser";
}

function detectOs(ua: string): string {
  if (/iPhone|iPod/.test(ua)) return "iOS";
  if (/iPad/.test(ua)) return "iPadOS";
  if (/Android/.test(ua)) return "Android";
  if (/CrOS/.test(ua)) return "ChromeOS";
  if (/Windows/.test(ua)) return "Windows";
  if (/Mac OS X|Macintosh/.test(ua)) return "macOS";
  if (/Linux/.test(ua)) return "Linux";
  return "";
}

export function describeUserAgent(ua: string | null | undefined): UserAgentSummary {
  if (!ua || !ua.trim()) return { browser: "Unknown", os: "", label: "Unknown device", kind: "unknown" };
  const browser = detectBrowser(ua);
  const os = detectOs(ua);
  let kind: DeviceKind = "desktop";
  if (browser === "Bot") kind = "bot";
  else if (/iPad|Tablet/.test(ua) || (/Android/.test(ua) && !/Mobile/.test(ua))) kind = "tablet";
  else if (/Mobi|iPhone|iPod|Android/.test(ua)) kind = "mobile";
  else if (browser === "Script") kind = "unknown";
  return { browser, os, label: os ? `${browser} on ${os}` : browser, kind };
}
