import { Fragment, createElement, isValidElement, type ReactNode } from "react";
import type { Locale, Namespace } from "./config";
import { formatMessage } from "./format";
import type { MessageValue, MessageVars, Messages } from "./types";

/**
 * Translator factory shared by the server helper (`getT`) and the client hook
 * (`useT`). A translator is a function `t(key, vars?)` returning a string,
 * with `t.rich(key, vars)` for messages that wrap parts in elements:
 *
 *   t.rich("login.signupPrompt", { link: (text) => <Link href="/register">{text}</Link> })
 *   // "New here? <link>Create an account</link>"
 *
 * Missing keys fall back to the English message, then to the key itself.
 */

/** Values accepted by `t.rich`: plain values, elements, or tag renderers. */
export type RichValue = MessageValue | ReactNode | ((chunks: ReactNode) => ReactNode);
export type RichVars = Record<string, RichValue>;

export interface Translator<K extends string = string> {
  (key: K, vars?: MessageVars): string;
  /** Format a message containing `<tag>…</tag>` or `<tag/>` markup, rendering tags through `vars[tag]`. */
  rich(key: K, vars?: RichVars): ReactNode;
  /** The unformatted template (e.g. to hand a pattern to a client component). */
  raw(key: K): string;
  /** Whether the key exists (in this language or the English fallback). */
  has(key: string): key is K;
  readonly locale: Locale;
  readonly namespace: Namespace;
}

export interface TranslatorOptions {
  locale: Locale;
  namespace: Namespace;
  /** Messages for the active locale (may already include the English fallback). */
  messages: Messages;
  /** English messages used when `messages` lacks a key. */
  fallback?: Messages;
  /** Called once per missing key (development warnings). */
  onMissing?: (namespace: Namespace, key: string) => void;
}

export function createTranslator<K extends string = string>(options: TranslatorOptions): Translator<K> {
  const { locale, namespace, messages, fallback, onMissing } = options;
  const reported = new Set<string>();

  const lookup = (key: string): string => {
    const own = Object.prototype.hasOwnProperty.call(messages, key) ? messages[key] : undefined;
    if (typeof own === "string") return own;
    const english = fallback && Object.prototype.hasOwnProperty.call(fallback, key) ? fallback[key] : undefined;
    if (typeof english === "string") return english;
    if (onMissing && !reported.has(key)) {
      reported.add(key);
      onMissing(namespace, key);
    }
    return key;
  };

  const t = ((key: K, vars?: MessageVars) => formatMessage(lookup(key), vars, locale)) as Translator<K>;
  Object.defineProperties(t, {
    rich: { value: (key: K, vars?: RichVars) => formatRich(lookup(key), vars ?? {}, locale) },
    raw: { value: (key: K) => lookup(key) },
    has: {
      value: (key: string) =>
        Object.prototype.hasOwnProperty.call(messages, key) || (!!fallback && Object.prototype.hasOwnProperty.call(fallback, key)),
    },
    locale: { value: locale, enumerable: true },
    namespace: { value: namespace, enumerable: true },
  });
  return t;
}

/* ------------------------------------------------------------------ */
/* Rich text                                                           */
/* ------------------------------------------------------------------ */

// Private-use characters mark where element values go after ICU formatting.
const TOKEN_OPEN = "";
const TOKEN_CLOSE = "";
const TOKEN_RE = /(\d+)/g;
const TAG_RE = /<(\/?)([A-Za-z][\w-]*)\s*(\/?)>/g;

function isPlain(value: RichValue): value is MessageValue {
  return value === null || value === undefined || typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

type RichTree = { tag: string | null; children: (string | RichTree)[] };

/** Split formatted text into a tag tree. Unbalanced tags are kept as text. */
function parseTags(text: string): RichTree {
  const root: RichTree = { tag: null, children: [] };
  const stack: RichTree[] = [root];
  let last = 0;
  TAG_RE.lastIndex = 0;
  for (let match = TAG_RE.exec(text); match; match = TAG_RE.exec(text)) {
    const [whole, closing, name, selfClosing] = match;
    const top = stack[stack.length - 1]!;
    if (match.index > last) top.children.push(text.slice(last, match.index));
    last = match.index + whole.length;
    if (selfClosing) {
      top.children.push({ tag: name!, children: [] });
    } else if (closing) {
      const index = stack.map((n) => n.tag).lastIndexOf(name!);
      if (index > 0) stack.length = index;
      else top.children.push(whole);
    } else {
      const node: RichTree = { tag: name!, children: [] };
      top.children.push(node);
      stack.push(node);
    }
  }
  if (last < text.length) stack[stack.length - 1]!.children.push(text.slice(last));
  return root;
}

function formatRich(template: string, vars: RichVars, locale: Locale): ReactNode {
  const elements: ReactNode[] = [];
  const plain: MessageVars = {};
  for (const [name, value] of Object.entries(vars)) {
    if (typeof value === "function") continue;
    if (isPlain(value)) plain[name] = value;
    else {
      plain[name] = `${TOKEN_OPEN}${elements.length}${TOKEN_CLOSE}`;
      elements.push(value);
    }
  }
  const formatted = formatMessage(template, plain, locale);
  let key = 0;

  const textNodes = (text: string): ReactNode[] => {
    const out: ReactNode[] = [];
    let last = 0;
    TOKEN_RE.lastIndex = 0;
    for (let match = TOKEN_RE.exec(text); match; match = TOKEN_RE.exec(text)) {
      if (match.index > last) out.push(text.slice(last, match.index));
      out.push(createElement(Fragment, { key: `e${key++}` }, elements[Number(match[1])]));
      last = match.index + match[0].length;
    }
    if (last < text.length) out.push(text.slice(last));
    return out;
  };

  const renderTree = (node: RichTree): ReactNode[] => {
    const out: ReactNode[] = [];
    for (const child of node.children) {
      if (typeof child === "string") {
        out.push(...textNodes(child));
        continue;
      }
      const inner = renderTree(child);
      const handler = vars[child.tag!];
      const content: ReactNode = inner.length === 0 ? null : inner.length === 1 ? inner[0] : inner;
      let rendered: ReactNode;
      if (typeof handler === "function") rendered = handler(content);
      else if (handler !== undefined && !isPlain(handler) && (isValidElement(handler) || Array.isArray(handler))) rendered = handler;
      else rendered = content;
      out.push(createElement(Fragment, { key: `t${key++}` }, rendered));
    }
    return out;
  };

  const nodes = renderTree(parseTags(formatted));
  if (nodes.length === 0) return "";
  if (nodes.length === 1) return nodes[0];
  return nodes;
}
