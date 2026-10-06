import { intlLocale, type Locale } from "./config";
import type { MessageVars } from "./types";

/**
 * ICU-lite message formatting (no library). Supported syntax:
 *
 *   {name}                               the value as written (strings, numbers, years…)
 *   {count, number}                      a number formatted for the locale ("12,000", "12 000")
 *   {count, plural, =0 {none} one {# lesson} other {# lessons}}
 *   {place, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}
 *   {role, select, admin {Administrator} other {Member}}
 *
 * Inside a plural branch `#` is the locale-formatted number. Branches may
 * nest placeholders and other plurals/selects. Plural categories come from
 * `Intl.PluralRules` (Arabic: zero/one/two/few/many/other; Hindi and French
 * treat 0 and 1 as "one"); a missing category falls back to `other`, and
 * `=N` exact matches win over categories.
 *
 * There is no quoting: apostrophes are ordinary characters (French and
 * Arabic text use them freely). A `{` that does not start a valid
 * placeholder is printed as is. A placeholder without a value is left
 * visible (`{name}`) so a missing variable is easy to spot.
 */

type Node =
  | string
  | { kind: "arg"; name: string; number: boolean }
  | { kind: "pound" }
  | { kind: "plural"; name: string; ordinal: boolean; offset: number; options: Record<string, Node[]> }
  | { kind: "select"; name: string; options: Record<string, Node[]> };

const NAME_RE = /[A-Za-z0-9_.-]/;
const WS_RE = /\s/;
const MAX_DEPTH = 8;

class Parser {
  pos = 0;
  constructor(readonly src: string) {}

  ws(): void {
    while (this.pos < this.src.length && WS_RE.test(this.src[this.pos]!)) this.pos++;
  }

  word(re: RegExp = NAME_RE): string {
    const start = this.pos;
    while (this.pos < this.src.length && re.test(this.src[this.pos]!)) this.pos++;
    return this.src.slice(start, this.pos);
  }

  /** Parse text and placeholders until the end, or an unmatched `}` when nested. */
  message(depth: number, inPlural: boolean): Node[] {
    const nodes: Node[] = [];
    let text = "";
    const flush = () => {
      if (text) nodes.push(text);
      text = "";
    };
    while (this.pos < this.src.length) {
      const ch = this.src[this.pos]!;
      if (ch === "}" && depth > 0) break;
      if (ch === "#" && inPlural) {
        flush();
        nodes.push({ kind: "pound" });
        this.pos++;
        continue;
      }
      if (ch === "{" && depth < MAX_DEPTH) {
        const start = this.pos;
        this.pos++;
        const arg = this.argument(depth, inPlural);
        if (arg) {
          flush();
          nodes.push(arg);
          continue;
        }
        this.pos = start;
      }
      text += ch;
      this.pos++;
    }
    flush();
    return nodes;
  }

  /**
   * After `{`: a placeholder up to and including its closing `}`, or null when malformed.
   * `inPlural` is true inside a plural branch: a select nested there inherits it, so `#`
   * in the select's branches is still the enclosing plural's number.
   */
  argument(depth: number, inPlural: boolean): Node | null {
    this.ws();
    const name = this.word();
    if (!name) return null;
    this.ws();
    const next = this.src[this.pos];
    if (next === "}") {
      this.pos++;
      return { kind: "arg", name, number: false };
    }
    if (next !== ",") return null;
    this.pos++;
    this.ws();
    const type = this.word(/[a-z]/);
    this.ws();
    if (this.src[this.pos] === "}") {
      this.pos++;
      return { kind: "arg", name, number: type === "number" };
    }
    if (this.src[this.pos] !== ",") return null;
    this.pos++;
    if (type !== "plural" && type !== "selectordinal" && type !== "select") return null;
    const plural = type !== "select";
    let offset = 0;
    const options: Record<string, Node[]> = {};
    for (;;) {
      this.ws();
      const ch = this.src[this.pos];
      if (ch === undefined) return null;
      if (ch === "}") {
        this.pos++;
        break;
      }
      let selector: string;
      if (ch === "=") {
        this.pos++;
        const digits = this.word(/[0-9.-]/);
        if (!digits || !Number.isFinite(Number(digits))) return null;
        selector = `=${Number(digits)}`;
      } else {
        selector = this.word(/[A-Za-z0-9_:-]/);
        if (!selector) return null;
        if (plural && selector.startsWith("offset:")) {
          let digits = selector.slice(7);
          if (!digits) {
            this.ws();
            digits = this.word(/[0-9]/);
          }
          const value = Number(digits);
          if (!digits || !Number.isFinite(value)) return null;
          offset = value;
          continue;
        }
      }
      this.ws();
      if (this.src[this.pos] !== "{") return null;
      this.pos++;
      const branch = this.message(depth + 1, plural || inPlural);
      if (this.src[this.pos] !== "}") return null;
      this.pos++;
      options[selector] = branch;
    }
    if (!options.other) return null;
    return plural ? { kind: "plural", name, ordinal: type === "selectordinal", offset, options } : { kind: "select", name, options };
  }
}

const AST_CACHE = new Map<string, Node[]>();
const AST_CACHE_LIMIT = 4000;

function parse(template: string): Node[] {
  const cached = AST_CACHE.get(template);
  if (cached) return cached;
  const nodes = new Parser(template).message(0, false);
  if (AST_CACHE.size >= AST_CACHE_LIMIT) AST_CACHE.clear();
  AST_CACHE.set(template, nodes);
  return nodes;
}

const pluralRulesCache = new Map<string, Intl.PluralRules>();
const numberFormatCache = new Map<string, Intl.NumberFormat>();

function pluralRules(locale: Locale | string, ordinal: boolean): Intl.PluralRules {
  const tag = intlLocale(locale);
  const key = `${tag}|${ordinal ? "o" : "c"}`;
  let rules = pluralRulesCache.get(key);
  if (!rules) {
    rules = new Intl.PluralRules(tag, { type: ordinal ? "ordinal" : "cardinal" });
    pluralRulesCache.set(key, rules);
  }
  return rules;
}

function numberFormat(locale: Locale | string): Intl.NumberFormat {
  const tag = intlLocale(locale);
  let nf = numberFormatCache.get(tag);
  if (!nf) {
    nf = new Intl.NumberFormat(tag, { maximumFractionDigits: 3 });
    numberFormatCache.set(tag, nf);
  }
  return nf;
}

/** The plural category Intl assigns a number in a locale ("zero", "one", "two", "few", "many", "other"). */
export function pluralCategory(locale: Locale | string, n: number, ordinal = false): Intl.LDMLPluralRule {
  return pluralRules(locale, ordinal).select(n);
}

function render(nodes: Node[], vars: MessageVars, locale: Locale | string, pound: number | null): string {
  let out = "";
  for (const node of nodes) {
    if (typeof node === "string") {
      out += node;
      continue;
    }
    switch (node.kind) {
      case "pound":
        out += pound === null ? "#" : numberFormat(locale).format(pound);
        break;
      case "arg": {
        const value = vars[node.name];
        if (value === undefined || value === null) out += `{${node.name}}`;
        else if (node.number && typeof value === "number") out += numberFormat(locale).format(value);
        else if (node.number && typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) out += numberFormat(locale).format(Number(value));
        else out += String(value);
        break;
      }
      case "plural": {
        const raw = vars[node.name];
        const n = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN;
        if (!Number.isFinite(n)) {
          out += render(node.options.other!, vars, locale, null);
          break;
        }
        const value = n - node.offset;
        const branch = node.options[`=${n}`] ?? node.options[pluralCategory(locale, value, node.ordinal)] ?? node.options.other!;
        out += render(branch, vars, locale, value);
        break;
      }
      case "select": {
        const raw = vars[node.name];
        const key = raw === undefined || raw === null ? "other" : String(raw);
        out += render(node.options[key] ?? node.options.other!, vars, locale, pound);
        break;
      }
    }
  }
  return out;
}

/** Format an ICU-lite template for a locale. */
export function formatMessage(template: string, vars: MessageVars = {}, locale: Locale | string = "en"): string {
  if (!template.includes("{")) return template;
  return render(parse(template), vars, locale, null);
}

/** Placeholder names a template uses (top level and inside branches), for consistency checks. */
export function placeholderNames(template: string): string[] {
  const names = new Set<string>();
  const walk = (nodes: Node[]) => {
    for (const node of nodes) {
      if (typeof node === "string" || node.kind === "pound") continue;
      names.add(node.name);
      if (node.kind === "plural" || node.kind === "select") for (const branch of Object.values(node.options)) walk(branch);
    }
  };
  walk(parse(template));
  return [...names].sort();
}

/** Plural/select branch selectors a template uses, per placeholder (for checking that translations cover a language's categories). */
export function pluralSelectors(template: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const walk = (nodes: Node[]) => {
    for (const node of nodes) {
      if (typeof node === "string" || node.kind === "pound" || node.kind === "arg") continue;
      if (node.kind === "plural") out[node.name] = [...new Set([...(out[node.name] ?? []), ...Object.keys(node.options)])];
      for (const branch of Object.values(node.options)) walk(branch);
    }
  };
  walk(parse(template));
  return out;
}
