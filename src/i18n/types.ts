/**
 * Shared i18n types. Message files are flat objects of dotted keys:
 *
 *   const messages = { "login.title": "Welcome back", ... } satisfies Messages;
 *
 * English is the source of truth: its object type defines the keys. Every
 * other language is a `Translation<typeof en>`: the same keys, all optional
 * (missing ones fall back to English), and unknown keys are a type error.
 */

/** A namespace's messages: dotted key → ICU-lite template. */
export type Messages = Record<string, string>;

/** A translation of an English message object: same keys, each optional. */
export type Translation<T extends Messages> = { readonly [K in keyof T]?: string };

/** Values for `{name}` placeholders, plurals and selects. */
export type MessageValue = string | number | boolean | null | undefined;
export type MessageVars = Record<string, MessageValue>;
