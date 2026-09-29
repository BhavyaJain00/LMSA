/**
 * Branded email layout.
 *
 * Templates describe an email as a small document of typed blocks
 * (`EmailDocument`); `renderEmail` turns it into both an HTML body
 * (table-based, inline styles, 600px, works in Gmail/Outlook/Apple Mail) and
 * a matching plain-text alternative, so the two parts never drift apart.
 *
 * Every piece of user-provided data is escaped here; blocks that carry HTML
 * (`markdown`) are produced by the safe markdown renderer. Pure module.
 */
import { absoluteUrl, escapeHtml, escapeMultiline, safeLinkUrl } from "../html";
import { markdownToEmailHtml, markdownToText } from "../markdown";

export interface EmailBrand {
  name: string;
  /** #rrggbb */
  accentColor: string;
  /** Text color that reads on the accent color. */
  accentTextColor: string;
  /** Absolute logo URL. */
  logoUrl?: string;
  /** Absolute app URL without trailing slash. */
  appUrl: string;
  /** Admin-configured footer text (Settings → Email). */
  footerText?: string;
  contactEmail?: string;
  dir: "ltr" | "rtl" | "auto";
}

export type CalloutTone = "info" | "success" | "warning" | "danger";

export type EmailBlock =
  /** Plain text paragraph; line breaks are kept. */
  | { type: "paragraph"; text: string }
  /** Markdown rendered with the safe email renderer. */
  | { type: "markdown"; markdown: string }
  /** Call-to-action button. `fallback` also prints the raw link under it. */
  | { type: "button"; label: string; url: string; fallback?: boolean }
  /** Label/value rows (order summary, class details…). */
  | { type: "details"; rows: { label: string; value: string }[]; title?: string }
  | { type: "callout"; tone: CalloutTone; text: string; title?: string }
  /** A prominent monospaced value, e.g. a certificate code. */
  | { type: "code"; text: string; label?: string }
  | { type: "list"; items: string[] }
  | { type: "quote"; text: string; cite?: string }
  | { type: "muted"; text: string }
  | { type: "divider" }
  /** Trusted, already-escaped HTML with its text equivalent (only for fragments supplied by app code). */
  | { type: "html"; html: string; text: string };

export interface EmailFooter {
  /** Why the recipient receives this email. */
  reason?: string;
  /** Link to the recipient's email preferences. */
  preferencesUrl?: string;
  /** One-click unsubscribe link for this category. */
  unsubscribeUrl?: string;
  unsubscribeLabel?: string;
}

export interface EmailDocument {
  /** Hidden inbox preview text. */
  preheader?: string;
  /** Small label above the heading, e.g. "Live class". */
  eyebrow?: string;
  /** Main heading; omitted when the body brings its own. */
  heading?: string;
  /** e.g. "Hi Alex," */
  greeting?: string;
  blocks: EmailBlock[];
  /** Sign-off lines, e.g. ["See you in class,", "The LearnLoop team"]. */
  signoff?: string[];
  footer?: EmailFooter;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const FONT_MONO = "SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace";
const INK = "#18181b";
const MUTED = "#71717a";
const BORDER = "#e4e4e7";
const PAGE_BG = "#f4f4f7";

const CALLOUT: Record<CalloutTone, { bg: string; border: string; fg: string }> = {
  info: { bg: "#eff6ff", border: "#bfdbfe", fg: "#1e3a8a" },
  success: { bg: "#f0fdf4", border: "#bbf7d0", fg: "#14532d" },
  warning: { bg: "#fffbeb", border: "#fde68a", fg: "#78350f" },
  danger: { bg: "#fef2f2", border: "#fecaca", fg: "#7f1d1d" },
};

/** Collapse whitespace and cap the length of a subject line. */
export function cleanSubject(subject: string, max = 200): string {
  const s = subject.replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s || "(no subject)";
}

/** First name for greetings ("Alex Johnson" → "Alex"). */
export function firstName(name: string | undefined | null): string {
  const n = (name ?? "").trim();
  if (!n) return "there";
  return n.split(/\s+/)[0]!;
}

/** Resolve an app path or absolute URL for use in an email; null when unsafe. */
export function emailUrl(brand: EmailBrand, pathOrUrl: string | undefined | null): string | null {
  if (!pathOrUrl) return null;
  return safeLinkUrl(pathOrUrl, brand.appUrl);
}

/* ------------------------------------------------------------------ */
/* Blocks                                                              */
/* ------------------------------------------------------------------ */

function blockHtml(brand: EmailBrand, block: EmailBlock): string {
  switch (block.type) {
    case "paragraph":
      return `<p style="margin:0 0 16px;line-height:1.6;">${escapeMultiline(block.text)}</p>`;
    case "markdown":
      return markdownToEmailHtml(block.markdown, { baseUrl: brand.appUrl, accentColor: brand.accentColor });
    case "button": {
      const url = emailUrl(brand, block.url);
      if (!url) return "";
      const button = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 ${block.fallback ? "12px" : "24px"};">
<tr><td align="center" bgcolor="${brand.accentColor}" style="border-radius:8px;background:${brand.accentColor};">
<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:12px 22px;font-family:${FONT};font-size:15px;font-weight:600;line-height:1.2;color:${brand.accentTextColor};text-decoration:none;border-radius:8px;">${escapeHtml(block.label)}</a>
</td></tr></table>`;
      if (!block.fallback) return button;
      return `${button}<p style="margin:0 0 24px;font-size:12px;line-height:1.5;color:${MUTED};">If the button doesn't work, copy and paste this link into your browser:<br><a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" style="color:${brand.accentColor};word-break:break-all;">${escapeHtml(url)}</a></p>`;
    }
    case "details": {
      const rows = block.rows
        .filter((r) => r.value !== "")
        .map(
          (r, i) =>
            `<tr><td style="padding:9px 14px;${i > 0 ? `border-top:1px solid ${BORDER};` : ""}font-size:13px;color:${MUTED};white-space:nowrap;vertical-align:top;width:35%;">${escapeHtml(r.label)}</td><td style="padding:9px 14px;${i > 0 ? `border-top:1px solid ${BORDER};` : ""}font-size:14px;color:${INK};vertical-align:top;word-break:break-word;">${escapeMultiline(r.value)}</td></tr>`,
        )
        .join("");
      if (!rows) return "";
      const title = block.title ? `<p style="margin:0 0 8px;font-size:13px;font-weight:600;color:${INK};">${escapeHtml(block.title)}</p>` : "";
      return `${title}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;border:1px solid ${BORDER};border-radius:8px;border-collapse:separate;">${rows}</table>`;
    }
    case "callout": {
      const c = CALLOUT[block.tone];
      const title = block.title ? `<strong style="display:block;margin-bottom:4px;font-weight:600;">${escapeHtml(block.title)}</strong>` : "";
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;"><tr><td style="padding:12px 14px;background:${c.bg};border:1px solid ${c.border};border-radius:8px;color:${c.fg};font-size:14px;line-height:1.5;">${title}${escapeMultiline(block.text)}</td></tr></table>`;
    }
    case "code": {
      const label = block.label ? `<p style="margin:0 0 6px;font-size:12px;text-transform:uppercase;letter-spacing:0.06em;color:${MUTED};">${escapeHtml(block.label)}</p>` : "";
      return `${label}<p style="margin:0 0 20px;padding:12px 16px;background:#f4f4f5;border-radius:8px;font-family:${FONT_MONO};font-size:20px;letter-spacing:0.08em;color:${INK};text-align:center;">${escapeHtml(block.text)}</p>`;
    }
    case "list":
      if (!block.items.length) return "";
      return `<ul style="margin:0 0 16px;padding-left:22px;">${block.items.map((it) => `<li style="margin:0 0 6px;line-height:1.6;">${escapeHtml(it)}</li>`).join("")}</ul>`;
    case "quote": {
      const cite = block.cite ? `<br><span style="font-size:12px;color:${MUTED};">— ${escapeHtml(block.cite)}</span>` : "";
      return `<blockquote style="margin:0 0 16px;padding:4px 0 4px 14px;border-left:3px solid ${brand.accentColor};color:#3f3f46;line-height:1.6;">${escapeMultiline(block.text)}${cite}</blockquote>`;
    }
    case "muted":
      return `<p style="margin:0 0 16px;font-size:13px;line-height:1.6;color:${MUTED};">${escapeMultiline(block.text)}</p>`;
    case "divider":
      return `<hr style="border:0;border-top:1px solid ${BORDER};margin:24px 0;">`;
    case "html":
      return block.html;
  }
}

function blockText(brand: EmailBrand, block: EmailBlock): string {
  switch (block.type) {
    case "paragraph":
    case "muted":
      return block.text.trim();
    case "markdown":
      return markdownToText(block.markdown, { baseUrl: brand.appUrl });
    case "button": {
      const url = emailUrl(brand, block.url);
      return url ? `${block.label}: ${url}` : "";
    }
    case "details": {
      const rows = block.rows.filter((r) => r.value !== "").map((r) => `${r.label}: ${r.value.replace(/\n/g, ", ")}`);
      return [block.title, ...rows].filter(Boolean).join("\n");
    }
    case "callout":
      return [block.title, block.text].filter(Boolean).join("\n");
    case "code":
      return [block.label ? `${block.label}:` : "", `    ${block.text}`].filter(Boolean).join("\n");
    case "list":
      return block.items.map((it) => `- ${it}`).join("\n");
    case "quote":
      return `${block.text
        .split("\n")
        .map((l) => `> ${l}`)
        .join("\n")}${block.cite ? `\n> — ${block.cite}` : ""}`;
    case "divider":
      return "----------";
    case "html":
      return block.text.trim();
  }
}

/* ------------------------------------------------------------------ */
/* Document                                                            */
/* ------------------------------------------------------------------ */

function headerHtml(brand: EmailBrand): string {
  const home = escapeHtml(absoluteUrl("/", brand.appUrl));
  if (brand.logoUrl) {
    return `<a href="${home}" target="_blank" rel="noopener noreferrer" style="text-decoration:none;"><img src="${escapeHtml(brand.logoUrl)}" alt="${escapeHtml(brand.name)}" height="36" style="display:block;height:36px;max-width:220px;width:auto;border:0;"></a>`;
  }
  return `<a href="${home}" target="_blank" rel="noopener noreferrer" style="font-family:${FONT};font-size:20px;font-weight:700;letter-spacing:-0.01em;color:${INK};text-decoration:none;"><span style="display:inline-block;width:10px;height:10px;border-radius:3px;background:${brand.accentColor};margin-right:8px;vertical-align:middle;"></span>${escapeHtml(brand.name)}</a>`;
}

function footerHtml(brand: EmailBrand, footer: EmailFooter | undefined): string {
  const parts: string[] = [];
  if (footer?.reason) parts.push(`<p style="margin:0 0 8px;">${escapeHtml(footer.reason)}</p>`);
  const links: string[] = [];
  const prefs = emailUrl(brand, footer?.preferencesUrl);
  if (prefs) links.push(`<a href="${escapeHtml(prefs)}" target="_blank" rel="noopener noreferrer" style="color:${MUTED};text-decoration:underline;">Email preferences</a>`);
  const unsub = emailUrl(brand, footer?.unsubscribeUrl);
  if (unsub) {
    links.push(
      `<a href="${escapeHtml(unsub)}" target="_blank" rel="noopener noreferrer" style="color:${MUTED};text-decoration:underline;">${escapeHtml(footer?.unsubscribeLabel ?? "Unsubscribe")}</a>`,
    );
  }
  if (links.length) parts.push(`<p style="margin:0 0 8px;">${links.join(" &nbsp;·&nbsp; ")}</p>`);
  if (brand.footerText) parts.push(`<p style="margin:0 0 8px;">${escapeMultiline(brand.footerText)}</p>`);
  const contact = brand.contactEmail
    ? ` · <a href="mailto:${escapeHtml(brand.contactEmail)}" style="color:${MUTED};text-decoration:underline;">${escapeHtml(brand.contactEmail)}</a>`
    : "";
  parts.push(
    `<p style="margin:0;">© ${new Date().getUTCFullYear()} <a href="${escapeHtml(absoluteUrl("/", brand.appUrl))}" target="_blank" rel="noopener noreferrer" style="color:${MUTED};text-decoration:none;">${escapeHtml(brand.name)}</a>${contact}</p>`,
  );
  return parts.join("");
}

/** Render a document to HTML + text. */
export function renderEmail(brand: EmailBrand, subject: string, doc: EmailDocument): RenderedEmail {
  const cleanTitle = cleanSubject(subject);
  const dir = brand.dir === "rtl" ? "rtl" : brand.dir === "ltr" ? "ltr" : "auto";
  const preheader = (doc.preheader ?? "").replace(/\s+/g, " ").trim().slice(0, 180);
  // Padding keeps inbox previews from pulling in body text after the preheader.
  const preheaderPad = "&#847;&zwnj;&nbsp;".repeat(40);
  const eyebrow = doc.eyebrow
    ? `<p style="margin:0 0 6px;font-size:12px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:${brand.accentColor};">${escapeHtml(doc.eyebrow)}</p>`
    : "";
  const heading = doc.heading
    ? `<h1 style="margin:0 0 20px;font-size:22px;line-height:1.3;font-weight:700;color:${INK};">${escapeHtml(doc.heading)}</h1>`
    : "";
  const greeting = doc.greeting ? `<p style="margin:0 0 16px;line-height:1.6;">${escapeHtml(doc.greeting)}</p>` : "";
  const body = doc.blocks.map((b) => blockHtml(brand, b)).filter(Boolean).join("\n");
  const signoff = doc.signoff?.length
    ? `<p style="margin:8px 0 0;line-height:1.6;">${doc.signoff.map((l) => escapeHtml(l)).join("<br>")}</p>`
    : "";

  const html = `<!DOCTYPE html>
<html lang="en" dir="${dir}" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(cleanTitle)}</title>
<style>
body{margin:0;padding:0;width:100%!important;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;}
table,td{border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt;}
img{border:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic;}
a{color:${brand.accentColor};}
@media only screen and (max-width:620px){.ll-container{width:100%!important;}.ll-pad{padding-left:20px!important;padding-right:20px!important;}.ll-card{border-radius:0!important;}}
</style>
</head>
<body style="margin:0;padding:0;background:${PAGE_BG};">
<div data-preheader style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${escapeHtml(preheader)}${preheaderPad}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${PAGE_BG};">
<tr><td align="center" style="padding:28px 12px;">
<table role="presentation" class="ll-container" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;">
<tr><td class="ll-pad" style="padding:0 8px 18px;">${headerHtml(brand)}</td></tr>
<tr><td class="ll-card" style="background:#ffffff;border:1px solid ${BORDER};border-radius:12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
<tr><td style="height:4px;line-height:4px;font-size:0;background:${brand.accentColor};border-radius:12px 12px 0 0;">&nbsp;</td></tr>
<tr><td class="ll-pad" style="padding:32px 40px 28px;font-family:${FONT};font-size:15px;line-height:1.6;color:${INK};">
${eyebrow}${heading}
${greeting}${body}${signoff}
</td></tr>
</table>
</td></tr>
<tr><td class="ll-pad" style="padding:22px 16px 8px;font-family:${FONT};font-size:12px;line-height:1.6;color:${MUTED};text-align:center;">${footerHtml(brand, doc.footer)}</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  const textParts: string[] = [brand.name.toUpperCase(), ""];
  if (doc.eyebrow) textParts.push(doc.eyebrow);
  if (doc.heading) textParts.push(doc.heading, "=".repeat(Math.min(60, Math.max(3, doc.heading.length))), "");
  if (doc.greeting) textParts.push(doc.greeting, "");
  for (const block of doc.blocks) {
    const t = blockText(brand, block);
    if (t) textParts.push(t, "");
  }
  if (doc.signoff?.length) textParts.push(doc.signoff.join("\n"), "");
  textParts.push("--");
  if (doc.footer?.reason) textParts.push(doc.footer.reason);
  const prefs = emailUrl(brand, doc.footer?.preferencesUrl);
  if (prefs) textParts.push(`Email preferences: ${prefs}`);
  const unsub = emailUrl(brand, doc.footer?.unsubscribeUrl);
  if (unsub) textParts.push(`${doc.footer?.unsubscribeLabel ?? "Unsubscribe"}: ${unsub}`);
  if (brand.footerText) textParts.push(brand.footerText);
  textParts.push(`${brand.name} · ${absoluteUrl("/", brand.appUrl)}`);

  const text = textParts
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { subject: cleanTitle, html, text };
}

/**
 * Wrap an HTML fragment supplied by another part of the app (already escaped
 * by the caller) in the branded layout. Used by `enqueueEmail` when a caller
 * passes a fragment instead of a full HTML document.
 */
export function wrapHtmlFragment(brand: EmailBrand, subject: string, fragmentHtml: string, text: string, footer?: EmailFooter): RenderedEmail {
  return renderEmail(brand, subject, {
    preheader: text.slice(0, 140),
    blocks: [{ type: "html", html: fragmentHtml, text }],
    footer,
  });
}
