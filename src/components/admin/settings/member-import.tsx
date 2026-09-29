"use client";

import Link from "next/link";
import { useId, useRef, useState, useTransition } from "react";
import type { Role } from "@/lib/types";
import {
  checkMemberImportAction,
  importMembersAction,
  type MemberImportCheck,
  type MemberImportResult,
} from "@/lib/actions/members";
import { Button, ButtonLink, buttonClasses } from "@/components/ui/button";
import { Card, CardBody, CardHeader, StatCard } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox, FormError } from "@/components/ui/input";
import { Icon } from "@/components/ui/icons";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Table, TBody, TD, TH, THead, TR, TableEmpty } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { cn, formatNumber } from "@/lib/utils";
import { ROLE_OPTIONS } from "./roles";
import { MEMBER_IMPORT_MAX_BYTES, MEMBER_IMPORT_MAX_ROWS, readMemberImportCsv, toCsv, type MemberImportRow } from "./member-import-csv";

const ROLE_LABEL: Record<Role, string> = Object.fromEntries(ROLE_OPTIONS.map((r) => [r.value, r.label])) as Record<Role, string>;

type Stage =
  | { kind: "upload" }
  | { kind: "preview"; fileName: string; rows: MemberImportRow[]; checks: MemberImportCheck[] }
  | { kind: "done"; fileName: string; result: MemberImportResult };

function RoleBadges({ roles }: { roles: Role[] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {roles.map((r) => (
        <Badge key={r} tone={r === "admin" ? "danger" : r === "student" ? "neutral" : "accent"}>
          {ROLE_LABEL[r]}
        </Badge>
      ))}
    </div>
  );
}

function downloadCsv(fileName: string, csv: string) {
  const blob = new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Bulk member import (Frappe: Data Import for users): upload a CSV, review
 * a validated preview, import the valid rows and download the results.
 */
export function MemberImport({ canGrantAdmin }: { canGrantAdmin: boolean }) {
  const toast = useToast();
  const inputId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState<Stage>({ kind: "upload" });
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [onlyErrors, setOnlyErrors] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [checking, startChecking] = useTransition();
  const [importing, startImporting] = useTransition();

  const reset = () => {
    setStage({ kind: "upload" });
    setError(null);
    setOnlyErrors(false);
    if (fileRef.current) fileRef.current.value = "";
  };

  const handleFile = (file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (!/\.csv$/i.test(file.name) && file.type !== "text/csv") {
      setError("Please choose a .csv file. In Excel or Google Sheets, use File → Download → CSV.");
      return;
    }
    if (file.size > MEMBER_IMPORT_MAX_BYTES) {
      setError("The file is larger than 1 MB. Split it into smaller files.");
      return;
    }
    startChecking(async () => {
      let text: string;
      try {
        text = await file.text();
      } catch {
        setError("The file could not be read. Try saving it again as CSV (UTF-8).");
        return;
      }
      const parsed = readMemberImportCsv(text);
      if (!parsed.ok) {
        setError(parsed.error);
        return;
      }
      const res = await checkMemberImportAction(parsed.rows);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setOnlyErrors(false);
      setStage({ kind: "preview", fileName: file.name, rows: parsed.rows, checks: res.data });
    });
  };

  const runImport = () => {
    if (stage.kind !== "preview") return;
    const { rows, fileName } = stage;
    startImporting(async () => {
      const res = await importMembersAction(rows);
      setConfirming(false);
      if (!res.ok) {
        toast.error("Import failed", res.error);
        return;
      }
      if (res.data.created.length) toast.success(res.message ?? "Members imported");
      else toast.error(res.message ?? "No members were imported", "Fix the rows with errors and upload the file again.");
      setStage({ kind: "done", fileName, result: res.data });
    });
  };

  if (stage.kind === "done") return <ImportSummary fileName={stage.fileName} result={stage.result} onAgain={reset} />;

  if (stage.kind === "preview") {
    const ready = stage.checks.filter((c) => !c.errors.length);
    const invalid = stage.checks.length - ready.length;
    const generated = ready.filter((c) => c.generatePassword).length;
    const visible = onlyErrors ? stage.checks.filter((c) => c.errors.length) : stage.checks;
    return (
      <div className="space-y-5">
        <Card>
          <CardHeader
            title="Preview"
            description={
              <>
                <span className="font-medium text-ink">{stage.fileName}</span> · {formatNumber(stage.checks.length)} {stage.checks.length === 1 ? "row" : "rows"}
              </>
            }
            actions={
              <Button variant="outline" size="sm" onClick={reset} disabled={importing} leftIcon={<Icon.Upload className="size-4" />}>
                <span className="hidden sm:inline">Choose another file</span>
                <span className="sm:hidden">Change</span>
              </Button>
            }
          />
          <CardBody className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge tone="success" size="md">
                <Icon.CheckCircle className="size-4" />
                {formatNumber(ready.length)} ready
              </Badge>
              {invalid > 0 && (
                <Badge tone="danger" size="md">
                  <Icon.AlertCircle className="size-4" />
                  {formatNumber(invalid)} with errors
                </Badge>
              )}
              {generated > 0 && (
                <Badge tone="info" size="md">
                  <Icon.Lock className="size-4" />
                  {formatNumber(generated)} generated {generated === 1 ? "password" : "passwords"}
                </Badge>
              )}
            </div>
            {invalid > 0 && (
              <p className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-ink">
                Rows with errors are skipped. Fix them in your file and upload it again, or import the {formatNumber(ready.length)} valid{" "}
                {ready.length === 1 ? "row" : "rows"} now.
              </p>
            )}
            {invalid > 0 && (
              <Checkbox id={`${inputId}-errors`} label="Show only rows with errors" checked={onlyErrors} onChange={(e) => setOnlyErrors(e.target.checked)} />
            )}
          </CardBody>
        </Card>

        <Table>
          <THead>
            <tr>
              <TH className="w-14">Line</TH>
              <TH>Member</TH>
              <TH className="hidden md:table-cell">Roles</TH>
              <TH className="hidden sm:table-cell">Password</TH>
              <TH>Status</TH>
            </tr>
          </THead>
          <TBody>
            {visible.length === 0 ? (
              <TableEmpty colSpan={5}>Every row is valid.</TableEmpty>
            ) : (
              visible.map((c) => (
                <TR key={c.line} className={cn(c.errors.length > 0 && "bg-danger/5")}>
                  <TD className="tabular-nums text-ink-muted">{c.line}</TD>
                  <TD>
                    <p className="max-w-56 truncate font-medium">{c.name || <span className="text-ink-faint">No name</span>}</p>
                    <p className="max-w-56 truncate text-xs text-ink-muted">{c.email || "No email"}</p>
                    <div className="mt-1 md:hidden">
                      <RoleBadges roles={c.roles} />
                    </div>
                  </TD>
                  <TD className="hidden md:table-cell">
                    <RoleBadges roles={c.roles} />
                  </TD>
                  <TD className="hidden whitespace-nowrap text-ink-muted sm:table-cell">{c.generatePassword ? "Generated" : "From file"}</TD>
                  <TD>
                    {c.errors.length ? (
                      <ul className="space-y-0.5 text-xs text-danger">
                        {c.errors.map((e) => (
                          <li key={e} className="flex gap-1">
                            <Icon.AlertCircle className="mt-px size-3.5 shrink-0" aria-hidden="true" />
                            <span>{e}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <Badge tone="success" dot>
                        Ready
                      </Badge>
                    )}
                  </TD>
                </TR>
              ))
            )}
          </TBody>
        </Table>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <ButtonLink href="/admin/members" variant="outline">
            Cancel
          </ButtonLink>
          <Button
            onClick={() => (invalid ? setConfirming(true) : runImport())}
            disabled={!ready.length}
            loading={importing && !confirming}
            leftIcon={<Icon.UserPlus className="size-4" />}
          >
            Import {formatNumber(ready.length)} {ready.length === 1 ? "member" : "members"}
          </Button>
        </div>

        <ConfirmDialog
          open={confirming}
          onClose={() => (importing ? undefined : setConfirming(false))}
          onConfirm={runImport}
          loading={importing}
          title={`Import ${formatNumber(ready.length)} ${ready.length === 1 ? "member" : "members"}?`}
          description={`${formatNumber(invalid)} ${invalid === 1 ? "row has" : "rows have"} errors and will be skipped. You can import them later from a corrected file.`}
          confirmLabel="Import valid rows"
        />
      </div>
    );
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <Card>
        <CardHeader title="Upload a CSV file" description={`One row per member, up to ${MEMBER_IMPORT_MAX_ROWS} rows per file.`} />
        <CardBody className="space-y-4">
          <label
            htmlFor={inputId}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              handleFile(e.dataTransfer.files[0]);
            }}
            className={cn(
              "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-card border-2 border-dashed px-4 py-10 text-center transition-colors",
              dragging ? "border-accent bg-accent/5" : "border-border hover:border-border-strong hover:bg-surface-2",
              checking && "pointer-events-none opacity-70",
            )}
          >
            <span className="rounded-full bg-accent/10 p-3 text-accent">
              {checking ? <Icon.Loader className="size-6 animate-spin" /> : <Icon.Upload className="size-6" />}
            </span>
            <span className="text-sm font-medium text-ink">{checking ? "Checking your file…" : "Drop a CSV file here or click to browse"}</span>
            <span className="text-xs text-ink-muted">CSV (UTF-8), up to 1 MB</span>
            <input
              ref={fileRef}
              id={inputId}
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              disabled={checking}
              onChange={(e) => handleFile(e.target.files?.[0])}
            />
          </label>
          <FormError message={error} />
          <div className="flex flex-wrap items-center gap-2">
            <a href="/admin/members/import/template" download className={buttonClasses({ variant: "outline", size: "sm" })}>
              <Icon.Download className="size-4" />
              Download template
            </a>
            <span className="text-xs text-ink-muted">Fill it in with a spreadsheet app and save as CSV.</span>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Columns" />
        <CardBody>
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="flex items-center gap-2 font-mono text-xs font-semibold text-ink">
                email <Badge tone="danger">Required</Badge>
              </dt>
              <dd className="mt-0.5 text-ink-muted">Must be unique, both in the file and among existing members.</dd>
            </div>
            <div>
              <dt className="flex items-center gap-2 font-mono text-xs font-semibold text-ink">
                name <Badge tone="danger">Required</Badge>
              </dt>
              <dd className="mt-0.5 text-ink-muted">The member&apos;s full name.</dd>
            </div>
            <div>
              <dt className="font-mono text-xs font-semibold text-ink">roles</dt>
              <dd className="mt-0.5 text-ink-muted">
                Separate several with semicolons: <span className="font-mono text-xs">student</span>, <span className="font-mono text-xs">course_creator</span>,{" "}
                <span className="font-mono text-xs">batch_evaluator</span>, <span className="font-mono text-xs">moderator</span>
                {canGrantAdmin ? (
                  <>
                    , <span className="font-mono text-xs">admin</span>
                  </>
                ) : null}
                . Leave empty for Student.
                {!canGrantAdmin && " Only administrators can import admins."}
              </dd>
            </div>
            <div>
              <dt className="font-mono text-xs font-semibold text-ink">password</dt>
              <dd className="mt-0.5 text-ink-muted">At least 8 characters with letters and numbers. Leave empty to generate one; generated passwords are shown once after the import.</dd>
            </div>
          </dl>
        </CardBody>
      </Card>
    </div>
  );
}

function ImportSummary({ fileName, result, onAgain }: { fileName: string; result: MemberImportResult; onAgain: () => void }) {
  const generated = result.created.filter((c) => c.generatedPassword).length;

  const downloadResults = () => {
    const rows: string[][] = [["line", "status", "name", "email", "username", "roles", "password", "errors"]];
    const all = [
      ...result.created.map((c) => ({ line: c.line, row: [String(c.line), "imported", c.name, c.email, c.username, c.roles.join("; "), c.generatedPassword ?? "", ""] })),
      ...result.skipped.map((s) => ({ line: s.line, row: [String(s.line), "skipped", "", s.email, "", "", "", s.errors.join(" ")] })),
    ].sort((a, b) => a.line - b.line);
    for (const r of all) rows.push(r.row);
    downloadCsv(`${fileName.replace(/\.csv$/i, "")}-import-results.csv`, toCsv(rows));
  };

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Imported" value={formatNumber(result.created.length)} icon={<Icon.UserPlus className="size-5" />} />
        <StatCard label="Skipped" value={formatNumber(result.skipped.length)} hint={result.skipped.length ? "Rows with errors" : "No errors"} icon={<Icon.AlertCircle className="size-5" />} />
        <StatCard label="Generated passwords" value={formatNumber(generated)} icon={<Icon.Lock className="size-5" />} />
      </div>

      {generated > 0 && (
        <p className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-ink">
          <Icon.AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
          Generated passwords are shown only on this page. Download the results now and share each password privately with its member.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button onClick={downloadResults} variant={generated ? "primary" : "outline"} leftIcon={<Icon.Download className="size-4" />}>
          Download results
        </Button>
        <Button variant="outline" onClick={onAgain} leftIcon={<Icon.Upload className="size-4" />}>
          Import another file
        </Button>
        <ButtonLink href="/admin/members" variant="ghost">
          Back to members
        </ButtonLink>
      </div>

      {result.created.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-ink">Imported members</h2>
          <Table>
            <THead>
              <tr>
                <TH className="w-14">Line</TH>
                <TH>Member</TH>
                <TH className="hidden md:table-cell">Roles</TH>
                <TH>Password</TH>
              </tr>
            </THead>
            <TBody>
              {result.created.map((c) => (
                <TR key={c.id}>
                  <TD className="tabular-nums text-ink-muted">{c.line}</TD>
                  <TD>
                    <Link href={`/admin/members/${c.id}`} className="block max-w-56 truncate font-medium hover:underline">
                      {c.name}
                    </Link>
                    <p className="max-w-56 truncate text-xs text-ink-muted">{c.email}</p>
                  </TD>
                  <TD className="hidden md:table-cell">
                    <RoleBadges roles={c.roles} />
                  </TD>
                  <TD>
                    {c.generatedPassword ? (
                      <code className="select-all rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs text-ink">{c.generatedPassword}</code>
                    ) : (
                      <span className="text-xs text-ink-muted">From file</span>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </section>
      )}

      {result.skipped.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-ink">Skipped rows</h2>
          <Table>
            <THead>
              <tr>
                <TH className="w-14">Line</TH>
                <TH>Email</TH>
                <TH>Errors</TH>
              </tr>
            </THead>
            <TBody>
              {result.skipped.map((s) => (
                <TR key={`${s.line}-${s.email}`}>
                  <TD className="tabular-nums text-ink-muted">{s.line}</TD>
                  <TD className="max-w-48 truncate">{s.email || <span className="text-ink-faint">No email</span>}</TD>
                  <TD>
                    <ul className="space-y-0.5 text-xs text-danger">
                      {s.errors.map((e) => (
                        <li key={e}>{e}</li>
                      ))}
                    </ul>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </section>
      )}
    </div>
  );
}
