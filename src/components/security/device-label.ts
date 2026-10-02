import type { UserAgentSummary } from "@/lib/auth/user-agent";
import type { MessageKey } from "@/i18n/catalog";
import type { Translator } from "@/i18n/translate";

/** Generic browser names from `describeUserAgent` that are words, not product names. */
const GENERIC: Record<string, MessageKey<"account">> = {
  Browser: "security.device.browser",
  Script: "security.device.script",
  Bot: "security.device.bot",
};

/** "Chrome on Windows" in the active language; product names stay as they are. */
export function deviceLabel(ua: UserAgentSummary, t: Translator<MessageKey<"account">>): string {
  if (!ua.os && (ua.browser === "Unknown" || !ua.browser)) return t("security.device.unknown");
  const browser = GENERIC[ua.browser] ? t(GENERIC[ua.browser]!) : ua.browser;
  return ua.os ? t("security.device.on", { browser, os: ua.os }) : browser;
}
