import { DEFAULT_LOCALE, type Locale, type Namespace } from "./config";
import type { Messages, Translation } from "./types";
import enCommon from "./messages/en/common";
import enShell from "./messages/en/shell";
import enAuth from "./messages/en/auth";
import enPublic from "./messages/en/public";
import enLearning from "./messages/en/learning";
import enAccount from "./messages/en/account";
import enAdmin from "./messages/en/admin";
import hiCommon from "./messages/hi/common";
import hiShell from "./messages/hi/shell";
import hiAuth from "./messages/hi/auth";
import hiPublic from "./messages/hi/public";
import hiLearning from "./messages/hi/learning";
import hiAccount from "./messages/hi/account";
import hiAdmin from "./messages/hi/admin";
import esCommon from "./messages/es/common";
import esShell from "./messages/es/shell";
import esAuth from "./messages/es/auth";
import esPublic from "./messages/es/public";
import esLearning from "./messages/es/learning";
import esAccount from "./messages/es/account";
import esAdmin from "./messages/es/admin";
import frCommon from "./messages/fr/common";
import frShell from "./messages/fr/shell";
import frAuth from "./messages/fr/auth";
import frPublic from "./messages/fr/public";
import frLearning from "./messages/fr/learning";
import frAccount from "./messages/fr/account";
import frAdmin from "./messages/fr/admin";
import arCommon from "./messages/ar/common";
import arShell from "./messages/ar/shell";
import arAuth from "./messages/ar/auth";
import arPublic from "./messages/ar/public";
import arLearning from "./messages/ar/learning";
import arAccount from "./messages/ar/account";
import arAdmin from "./messages/ar/admin";

/**
 * Every message of every language, keyed by namespace. Imported on the
 * server (getT, the provider) and by tests; client components receive only
 * the namespaces their page asks for, already merged with English.
 *
 * Translators never edit this file: each namespace file is imported here.
 */

/** The English catalog type: it defines the keys of every namespace. */
export interface EnglishCatalog {
  common: typeof enCommon;
  shell: typeof enShell;
  auth: typeof enAuth;
  public: typeof enPublic;
  learning: typeof enLearning;
  account: typeof enAccount;
  admin: typeof enAdmin;
}

/** Keys of a namespace, from the English source. */
export type MessageKey<N extends Namespace> = Extract<keyof EnglishCatalog[N], string>;

export const ENGLISH: EnglishCatalog = {
  common: enCommon,
  shell: enShell,
  auth: enAuth,
  public: enPublic,
  learning: enLearning,
  account: enAccount,
  admin: enAdmin,
};

type TranslatedLocale = Exclude<Locale, typeof DEFAULT_LOCALE>;

export const TRANSLATIONS: { [L in TranslatedLocale]: { [N in Namespace]: Translation<EnglishCatalog[N]> } } = {
  hi: { common: hiCommon, shell: hiShell, auth: hiAuth, public: hiPublic, learning: hiLearning, account: hiAccount, admin: hiAdmin },
  es: { common: esCommon, shell: esShell, auth: esAuth, public: esPublic, learning: esLearning, account: esAccount, admin: esAdmin },
  fr: { common: frCommon, shell: frShell, auth: frAuth, public: frPublic, learning: frLearning, account: frAccount, admin: frAdmin },
  ar: { common: arCommon, shell: arShell, auth: arAuth, public: arPublic, learning: arLearning, account: arAccount, admin: arAdmin },
};

const merged = new Map<string, Messages>();

/** English messages of a namespace. */
export function englishMessages(namespace: Namespace): Messages {
  return ENGLISH[namespace] as Messages;
}

/** The translated messages only (no fallback): for completeness reports and tests. */
export function translatedMessages(locale: Locale, namespace: Namespace): Messages {
  if (locale === DEFAULT_LOCALE) return englishMessages(namespace);
  return TRANSLATIONS[locale][namespace] as Messages;
}

/** A namespace in a language with English filling every missing key (what the UI uses). */
export function catalogMessages(locale: Locale, namespace: Namespace): Messages {
  if (locale === DEFAULT_LOCALE) return englishMessages(namespace);
  const cacheKey = `${locale}:${namespace}`;
  let messages = merged.get(cacheKey);
  if (!messages) {
    messages = { ...englishMessages(namespace) };
    for (const [key, value] of Object.entries(translatedMessages(locale, namespace))) {
      if (typeof value === "string" && value.length > 0) messages[key] = value;
    }
    merged.set(cacheKey, messages);
  }
  return messages;
}

/** Only the keys starting with one of the prefixes (to serialize a slice of a large namespace). */
export function pickMessages(messages: Messages, prefixes: readonly string[] | undefined): Messages {
  if (!prefixes?.length) return messages;
  const out: Messages = {};
  for (const [key, value] of Object.entries(messages)) {
    if (prefixes.some((prefix) => key === prefix || key.startsWith(prefix.endsWith(".") ? prefix : `${prefix}.`))) out[key] = value;
  }
  return out;
}
