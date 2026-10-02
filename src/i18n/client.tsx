"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { DEFAULT_LOCALE, localeDir, type Locale, type Namespace, type TextDirection } from "./config";
import { createFormatters, type Formatters } from "./formatters";
import { createTranslator, type Translator } from "./translate";
import type { MessageKey } from "./catalog";
import { mergeProvided, type ProvidedMessages } from "./provided";
import englishCommon from "./messages/en/common";

/**
 * Client-side i18n. Server layouts render `<I18nProvider namespaces={[…]}>`
 * (from `@/i18n/provider`), which hands this provider the active locale and
 * the messages of just those namespaces. Nested providers add to the ones
 * above them, key by key (see `./provided.ts`). The root layout provides
 * `common`, `shell` and the `global.` keys of every other namespace. In a
 * client component:
 *
 *   const t = useT("learning");
 *   t("player.next");
 *   const f = useFormatter();  f.relative(comment.createdAt)
 */

interface I18nState {
  locale: Locale;
  messages: ProvidedMessages;
}

const I18nContext = createContext<I18nState | null>(null);

export function I18nClientProvider({ locale, messages, children }: { locale: Locale; messages: ProvidedMessages; children: ReactNode }) {
  const parent = useContext(I18nContext);
  const value = useMemo<I18nState>(() => ({ locale, messages: parent ? mergeProvided(parent.messages, messages) : messages }), [locale, messages, parent]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

const warned = new Set<string>();

function warn(message: string): void {
  if (process.env.NODE_ENV === "production" || warned.has(message)) return;
  warned.add(message);
  console.error(message);
}

/** The active interface language. */
export function useLocale(): Locale {
  return useContext(I18nContext)?.locale ?? DEFAULT_LOCALE;
}

/** Text direction of the active language. */
export function useDirection(): TextDirection {
  return localeDir(useLocale());
}

/**
 * A translator for a namespace the surrounding layout provides. `common` is
 * always available (the root layout provides it, and English is bundled as a
 * last resort); other namespaces must be provided by a server layout or page,
 * otherwise keys are shown as-is and a development error names the missing provider.
 */
export function useT<N extends Namespace>(namespace: N): Translator<MessageKey<N>> {
  const state = useContext(I18nContext);
  const locale = state?.locale ?? DEFAULT_LOCALE;
  const provided = state?.messages[namespace];
  return useMemo(() => {
    let messages = provided;
    if (!messages) {
      if (namespace === "common") messages = englishCommon;
      else {
        warn(`[i18n] useT("${namespace}") is used outside <I18nProvider namespaces={["${namespace}"]}>: messages are missing.`);
        messages = {};
      }
    }
    return createTranslator<MessageKey<N>>({
      locale,
      namespace,
      messages,
      fallback: namespace === "common" ? englishCommon : undefined,
      onMissing: (ns, key) => warn(`[i18n] Missing message "${ns}:${key}" (not provided to the client, or not defined).`),
    });
  }, [locale, namespace, provided]);
}

/** `Intl` formatters bound to the active language. */
export function useFormatter(): Formatters {
  const locale = useLocale();
  return useMemo(() => createFormatters(locale), [locale]);
}
