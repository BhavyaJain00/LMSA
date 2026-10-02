import type { Role } from "@/lib/types";
import { ROLE_OPTIONS, isRole } from "./roles";

/**
 * Hand-rolled CSV support for the member bulk import (no libraries). Shared
 * by the browser (parse + preview) and the server actions (validation), so it
 * must stay free of server-only imports.
 */

/** Largest file the import accepts, in rows (excluding the header). */
export const MEMBER_IMPORT_MAX_ROWS = 500;
/** Largest file the import accepts, in bytes. */
export const MEMBER_IMPORT_MAX_BYTES = 1024 * 1024;

export interface MemberImportRow {
  /** 1-based line number in the file (the header is line 1). */
  line: number;
  email: string;
  name: string;
  /** Raw roles cell, e.g. "student; course_creator". */
  roles: string;
  /** Empty when a password should be generated. */
  password: string;
}

export const MEMBER_IMPORT_COLUMNS = ["email", "name", "roles", "password"] as const;

export const MEMBER_IMPORT_TEMPLATE = [
  "email,name,roles,password",
  "ada@example.com,Ada Lovelace,student,",
  'grace@example.com,Grace Hopper,"course_creator; batch_evaluator",Welcome2024',
  "alan@example.com,Alan Turing,moderator,",
].join("\r\n");

/**
 * Parse CSV text (RFC 4180: quoted fields, doubled quotes, commas and line
 * breaks inside quotes, CRLF or LF endings, optional BOM). Returns rows of
 * cells, each tagged with the line it started on.
 */
export function parseCsv(text: string): { cells: string[]; line: number }[] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: { cells: string[]; line: number }[] = [];
  let cells: string[] = [];
  let cell = "";
  let quoted = false;
  let line = 1;
  let rowLine = 1;
  let i = 0;

  const endCell = () => {
    cells.push(cell);
    cell = "";
  };
  const endRow = () => {
    endCell();
    rows.push({ cells, line: rowLine });
    cells = [];
  };

  while (i < src.length) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      if (ch === "\n") line++;
      cell += ch;
      i++;
      continue;
    }
    if (ch === '"' && cell.trim() === "") {
      cell = "";
      quoted = true;
      i++;
    } else if (ch === ",") {
      endCell();
      i++;
    } else if (ch === "\r" || ch === "\n") {
      endRow();
      i += ch === "\r" && src[i + 1] === "\n" ? 2 : 1;
      line++;
      rowLine = line;
    } else {
      cell += ch;
      i++;
    }
  }
  if (cell !== "" || cells.length) endRow();
  // Drop fully blank lines.
  return rows.filter((r) => r.cells.some((c) => c.trim() !== ""));
}

const HEADER_ALIASES: Record<(typeof MEMBER_IMPORT_COLUMNS)[number], string[]> = {
  email: ["email", "email address", "e-mail", "email id", "user email"],
  name: ["name", "full name", "fullname", "full_name", "member name"],
  roles: ["roles", "role"],
  password: ["password", "new password"],
};

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

/**
 * Turn CSV text into import rows. Needs an `email` and a `name` column; the
 * `roles` and `password` columns are optional. Column order does not matter.
 */
/** Why a file could not be read, so the interface can explain it in the viewer's language. */
export type MemberImportCsvProblem =
  | { code: "empty" }
  | { code: "missingColumns"; missing: ("email" | "name")[] }
  | { code: "headerOnly" }
  | { code: "tooManyRows"; rows: number; max: number };

export function readMemberImportCsv(text: string): { ok: true; rows: MemberImportRow[] } | ({ ok: false; error: string } & MemberImportCsvProblem) {
  const parsed = parseCsv(text);
  if (!parsed.length) return { ok: false, code: "empty", error: "The file is empty. Add a header row and one row per member." };
  const header = parsed[0].cells.map(normalizeHeader);
  const index = (key: keyof typeof HEADER_ALIASES) => header.findIndex((h) => HEADER_ALIASES[key].some((a) => normalizeHeader(a) === h));
  const col = { email: index("email"), name: index("name"), roles: index("roles"), password: index("password") };
  const missing = (["email", "name"] as const).filter((k) => col[k] < 0);
  if (missing.length) {
    return {
      ok: false,
      code: "missingColumns",
      missing: [...missing],
      error: `Missing ${missing.join(" and ")} ${missing.length === 1 ? "column" : "columns"}. The header row must include email and name (roles and password are optional).`,
    };
  }
  const body = parsed.slice(1);
  if (!body.length) return { ok: false, code: "headerOnly", error: "The file only has a header row. Add one row per member below it." };
  if (body.length > MEMBER_IMPORT_MAX_ROWS) {
    return {
      ok: false,
      code: "tooManyRows",
      rows: body.length,
      max: MEMBER_IMPORT_MAX_ROWS,
      error: `The file has ${body.length} rows. Import at most ${MEMBER_IMPORT_MAX_ROWS} members at a time by splitting it into smaller files.`,
    };
  }
  const at = (cells: string[], i: number) => (i >= 0 ? (cells[i] ?? "").trim() : "");
  return {
    ok: true,
    rows: body.map((r) => ({
      line: r.line,
      email: at(r.cells, col.email).toLowerCase(),
      name: at(r.cells, col.name).replace(/\s+/g, " "),
      roles: at(r.cells, col.roles),
      password: col.password >= 0 ? (r.cells[col.password] ?? "") : "",
    })),
  };
}

const ROLE_LOOKUP: Map<string, Role> = new Map(
  ROLE_OPTIONS.flatMap((r) => [
    [r.value, r.value],
    [r.value.replace(/_/g, " "), r.value],
    [r.label.toLowerCase(), r.value],
  ] as [string, Role][]).concat([
    ["evaluator", "batch_evaluator"],
    ["batch evaluator", "batch_evaluator"],
    ["creator", "course_creator"],
    ["instructor", "course_creator"],
    ["learner", "student"],
    ["lms student", "student"],
    ["administrator", "admin"],
  ]),
);

/**
 * Parse a roles cell. Roles are separated by semicolons, pipes or commas
 * (inside a quoted cell) and may be written as the value (course_creator) or
 * the label (Course Creator), in any case. An empty cell means Student.
 */
export function parseRoleList(raw: string): { roles: Role[]; invalid: string[] } {
  const roles: Role[] = [];
  const invalid: string[] = [];
  for (const part of raw.split(/[;|,]/)) {
    const token = part.trim();
    if (!token) continue;
    const key = token.toLowerCase().replace(/[-]+/g, " ").replace(/\s+/g, " ");
    const role = isRole(key) ? key : ROLE_LOOKUP.get(key) ?? ROLE_LOOKUP.get(key.replace(/ /g, "_"));
    if (!role) invalid.push(token);
    else if (!roles.includes(role)) roles.push(role);
  }
  return { roles, invalid };
}

/** Quote a CSV cell and neutralize spreadsheet formulas. */
export function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(rows: string[][]): string {
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
}
