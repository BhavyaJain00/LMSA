"use client";

import type { ConsentState } from "./consent-client";

export interface ConsentManagerProps {
  /** `settings.legal.cookieBanner` */
  enabled: boolean;
  /** Decision read from the `ll_consent` cookie on the server (avoids a banner flash). */
  initialConsent: ConsentState;
}

/**
 * Cookie-consent banner and preferences dialog, mounted once in the root
 * layout. Foundation stub: renders nothing until the legal area implements
 * the banner (optional cookies stay off while the visitor is undecided).
 */
export function ConsentManager(props: ConsentManagerProps) {
  void props;
  return null;
}
