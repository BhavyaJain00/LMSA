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
import { cn } from "@/lib/utils";
import { useFormatter, useT } from "@/i18n/client";
import { MEMBER_IMPORT_MAX_BYTES, MEMBER_IMPORT_MAX_ROWS, readMemberImportCsv, toCsv, type MemberImportRow } from "./member-import-csv";

type Stage =
  | { kind: "upload" }
  | { kind: "preview"; fileName: string; rows: MemberImportRow[]; checks: MemberImportCheck[] }
  | { kind: "done"; fileName: string; result: MemberImportResult };

function RoleBadges({ roles }: { roles: Role[] }) {
  const ts = useT("shell");
  return (
    <div className="flex flex-wrap gap-1">
      {roles.map((r) => (
        <Badge key={r} tone={r === "admin" ? "danger" : r === "student" ? "neutral" : "accent"}>
          {ts(`roles.${r}`)}
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
export function MemberImport({ canGrantAdmin, minPasswordLength }: { canGrantAdmin: boolean; minPasswordLength: number }) {
  const t = useT("admin");
  const f = useFormatter();
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
      setError(t("members.import.errors.notCsv"));
      return;
    }
    if (file.size > MEMBER_IMPORT_MAX_BYTES) {
      setError(t("members.import.errors.tooLarge"));
      return;
    }
    startChecking(async () => {
      let text: string;
      try {
        text = await file.text();
      } catch {
        setError(t("members.import.errors.unreadable"));
        return;
      }
      const parsed = readMemberImportCsv(text);
      if (!parsed.ok) {
        setError(
          parsed.code === "empty"
            ? t("members.import.errors.empty")
            : parsed.code === "headerOnly"
              ? t("members.import.errors.headerOnly")
              : parsed.code === "tooManyRows"
                ? t("members.import.errors.tooManyRows", { rows: parsed.rows, max: parsed.max })
                : t("members.import.errors.missingColumns", { columns: f.list(parsed.missing), count: parsed.missing.length }),
        );
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
        toast.error(t("members.import.failed"), res.error);
        return;
      }
      if (res.data.created.length) toast.success(res.message ?? t("members.import.imported"));
      else toast.error(res.message ?? t("members.import.noneImported"), t("members.import.fixRows"));
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
            title={t("members.import.preview")}
            description={
              <>
                <span className="font-medium text-ink">{stage.fileName}</span> · {t("members.import.rows", { count: stage.checks.length })}
              </>
            }
            actions={
              <Button variant="outline" size="sm" onClick={reset} disabled={importing} leftIcon={<Icon.Upload className="size-4" />}>
                <span className="hidden sm:inline">{t("members.import.chooseAnother")}</span>
                <span className="sm:hidden">{t("members.import.change")}</span>
              </Button>
            }
          />
          <CardBody className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge tone="success" size="md">
                <Icon.CheckCircle className="size-4" />
                {t("members.import.ready", { count: ready.length })}
              </Badge>
              {invalid > 0 && (
                <Badge tone="danger" size="md">
                  <Icon.AlertCircle className="size-4" />
                  {t("members.import.withErrors", { count: invalid })}
                </Badge>
              )}
              {generated > 0 && (
                <Badge tone="info" size="md">
                  <Icon.Lock className="size-4" />
                  {t("members.import.generated", { count: generated })}
                </Badge>
              )}
            </div>
            {invalid > 0 && (
              <p className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-ink">
                {t("members.import.skipNotice", { count: ready.length })}
              </p>
            )}
            {invalid > 0 && (
              <Checkbox id={`${inputId}-errors`} label={t("members.import.onlyErrors")} checked={onlyErrors} onChange={(e) => setOnlyErrors(e.target.checked)} />
            )}
          </CardBody>
        </Card>

        <Table>
          <THead>
            <tr>
              <TH className="w-14">{t("members.import.columns.line")}</TH>
              <TH>{t("members.import.columns.member")}</TH>
              <TH className="hidden md:table-cell">{t("members.import.columns.roles")}</TH>
              <TH className="hidden sm:table-cell">{t("members.import.columns.password")}</TH>
              <TH>{t("members.import.columns.status")}</TH>
            </tr>
          </THead>
          <TBody>
            {visible.length === 0 ? (
              <TableEmpty colSpan={5}>{t("members.import.allValid")}</TableEmpty>
            ) : (
              visible.map((c) => (
                <TR key={c.line} className={cn(c.errors.length > 0 && "bg-danger/5")}>
                  <TD className="tabular-nums text-ink-muted">{c.line}</TD>
                  <TD>
                    <p className="max-w-56 truncate font-medium">{c.name || <span className="text-ink-faint">{t("members.import.noName")}</span>}</p>
                    <p className="max-w-56 truncate text-xs text-ink-muted">{c.email || t("members.import.noEmail")}</p>
                    <div className="mt-1 md:hidden">
                      <RoleBadges roles={c.roles} />
                    </div>
                  </TD>
                  <TD className="hidden md:table-cell">
                    <RoleBadges roles={c.roles} />
                  </TD>
                  <TD className="hidden whitespace-nowrap text-ink-muted sm:table-cell">{c.generatePassword ? t("members.import.passwordGenerated") : t("members.import.passwordFromFile")}</TD>
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
                        {t("members.import.statusReady")}
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
            {t("shared.cancel")}
          </ButtonLink>
          <Button
            onClick={() => (invalid ? setConfirming(true) : runImport())}
            disabled={!ready.length}
            loading={importing && !confirming}
            leftIcon={<Icon.UserPlus className="size-4" />}
          >
            {t("members.import.importCount", { count: ready.length })}
          </Button>
        </div>

        <ConfirmDialog
          open={confirming}
          onClose={() => (importing ? undefined : setConfirming(false))}
          onConfirm={runImport}
          loading={importing}
          title={t("members.import.confirmTitle", { count: ready.length })}
          description={t("members.import.confirmDescription", { count: invalid })}
          confirmLabel={t("members.import.confirmLabel")}
        />
      </div>
    );
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <Card>
        <CardHeader title={t("members.import.uploadTitle")} description={t("members.import.uploadDescription", { max: MEMBER_IMPORT_MAX_ROWS })} />
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
            <span className="text-sm font-medium text-ink">{checking ? t("members.import.checking") : t("members.import.drop")}</span>
            <span className="text-xs text-ink-muted">{t("members.import.limits")}</span>
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
              {t("members.import.template")}
            </a>
            <span className="text-xs text-ink-muted">{t("members.import.templateHint")}</span>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("members.import.columnsTitle")} />
        <CardBody>
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="flex items-center gap-2 font-mono text-xs font-semibold text-ink">
                email <Badge tone="danger">{t("members.import.required")}</Badge>
              </dt>
              <dd className="mt-0.5 text-ink-muted">{t("members.import.emailHelp")}</dd>
            </div>
            <div>
              <dt className="flex items-center gap-2 font-mono text-xs font-semibold text-ink">
                name <Badge tone="danger">{t("members.import.required")}</Badge>
              </dt>
              <dd className="mt-0.5 text-ink-muted">{t("members.import.nameHelp")}</dd>
            </div>
            <div>
              <dt className="font-mono text-xs font-semibold text-ink">roles</dt>
              <dd className="mt-0.5 text-ink-muted">
                {t.rich("members.import.rolesHelp", {
                  values: (
                    <span className="font-mono text-xs" dir="ltr">
                      {(canGrantAdmin ? ["student", "course_creator", "batch_evaluator", "moderator", "admin"] : ["student", "course_creator", "batch_evaluator", "moderator"]).join(", ")}
                    </span>
                  ),
                })}
                {!canGrantAdmin && ` ${t("members.import.adminsOnly")}`}
              </dd>
            </div>
            <div>
              <dt className="font-mono text-xs font-semibold text-ink">password</dt>
              <dd className="mt-0.5 text-ink-muted">{t("members.import.passwordHelp", { count: minPasswordLength })}</dd>
            </div>
          </dl>
        </CardBody>
      </Card>
    </div>
  );
}

function ImportSummary({ fileName, result, onAgain }: { fileName: string; result: MemberImportResult; onAgain: () => void }) {
  const t = useT("admin");
  const f = useFormatter();
  const formatNumber = (n: number) => f.number(n);
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
        <StatCard label={t("members.import.summary.imported")} value={formatNumber(result.created.length)} icon={<Icon.UserPlus className="size-5" />} />
        <StatCard label={t("members.import.summary.skipped")} value={formatNumber(result.skipped.length)} hint={result.skipped.length ? t("members.import.summary.rowsWithErrors") : t("members.import.summary.noErrors")} icon={<Icon.AlertCircle className="size-5" />} />
        <StatCard label={t("members.import.summary.generated")} value={formatNumber(generated)} icon={<Icon.Lock className="size-5" />} />
      </div>

      {generated > 0 && (
        <p className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-ink">
          <Icon.AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
          {t("members.import.summary.passwordWarning")}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button onClick={downloadResults} variant={generated ? "primary" : "outline"} leftIcon={<Icon.Download className="size-4" />}>
          {t("members.import.summary.download")}
        </Button>
        <Button variant="outline" onClick={onAgain} leftIcon={<Icon.Upload className="size-4" />}>
          {t("members.import.summary.again")}
        </Button>
        <ButtonLink href="/admin/members" variant="ghost">
          {t("errorPages.backToMembers")}
        </ButtonLink>
      </div>

      {result.created.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-ink">{t("members.import.summary.importedMembers")}</h2>
          <Table>
            <THead>
              <tr>
                <TH className="w-14">{t("members.import.columns.line")}</TH>
                <TH>{t("members.import.columns.member")}</TH>
                <TH className="hidden md:table-cell">{t("members.import.columns.roles")}</TH>
                <TH>{t("members.import.columns.password")}</TH>
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
                      <span className="text-xs text-ink-muted">{t("members.import.passwordFromFile")}</span>
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
          <h2 className="text-sm font-semibold text-ink">{t("members.import.summary.skippedRows")}</h2>
          <Table>
            <THead>
              <tr>
                <TH className="w-14">{t("members.import.columns.line")}</TH>
                <TH>{t("members.form.email")}</TH>
                <TH>{t("members.import.columns.errors")}</TH>
              </tr>
            </THead>
            <TBody>
              {result.skipped.map((s) => (
                <TR key={`${s.line}-${s.email}`}>
                  <TD className="tabular-nums text-ink-muted">{s.line}</TD>
                  <TD className="max-w-48 truncate">{s.email || <span className="text-ink-faint">{t("members.import.noEmail")}</span>}</TD>
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
