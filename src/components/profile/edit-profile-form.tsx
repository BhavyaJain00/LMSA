"use client";

import Link from "next/link";
import { useActionState, useEffect, useMemo, useState, type KeyboardEvent } from "react";
import type { EducationDetail, SocialLinks, WorkExperience } from "@/lib/types";
import { updateProfileAction } from "@/lib/actions/profile";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink, IconButton } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { FileUpload } from "@/components/ui/file-upload";
import { Icon } from "@/components/ui/icons";
import { Checkbox, Field, FormError, Input, Select, Textarea } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/tabs";
import { Markdown } from "@/lib/markdown";
import { cn, uid } from "@/lib/utils";
import { useFormatter, useT } from "@/i18n/client";
import { OpenToBadge, openToValues, type OpenTo } from "./open-to-badge";
import { socialMeta } from "./social-icons";

export interface EditProfileValues {
  name: string;
  username: string;
  headline: string;
  location: string;
  /** "" when the member is neither looking for work nor hiring. */
  openTo: OpenTo | "";
  bio: string;
  avatarUrl: string;
  coverImageUrl: string;
  socials: Required<{ [K in keyof SocialLinks]: string }>;
  skills: string[];
  education: EducationDetail[];
  workExperience: WorkExperience[];
}

const MAX_SKILLS = 30;

/* ------------------------------------------------------------------ */
/* Skills                                                               */
/* ------------------------------------------------------------------ */

function SkillsInput({ value, onChange, error }: { value: string[]; onChange: (next: string[]) => void; error?: string }) {
  const [draft, setDraft] = useState("");
  const t = useT("account");

  const add = (raw: string) => {
    const parts = raw
      .split(",")
      .map((s) => s.trim().slice(0, 40))
      .filter(Boolean);
    if (!parts.length) return;
    const next = [...value];
    for (const p of parts) {
      if (next.length >= MAX_SKILLS) break;
      if (!next.some((s) => s.toLowerCase() === p.toLowerCase())) next.push(p);
    }
    onChange(next);
    setDraft("");
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      add(draft);
    } else if (e.key === "Backspace" && !draft && value.length) {
      onChange(value.slice(0, -1));
    }
  };

  return (
    <Field label={t("profile.edit.skills")} htmlFor="skill-input" hint={t("profile.edit.skillsHint", { count: value.length, max: MAX_SKILLS })} error={error}>
      <div
        className={cn(
          "flex min-h-9.5 flex-wrap items-center gap-1.5 rounded-lg border border-border-strong bg-surface-1 px-2 py-1.5 focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/25",
          error && "border-danger",
        )}
      >
        {value.map((skill) => (
          <span key={skill} className="inline-flex items-center gap-1 rounded-md bg-surface-2 py-0.5 ps-2 pe-1 text-xs font-medium text-ink">
            {skill}
            <button
              type="button"
              onClick={() => onChange(value.filter((s) => s !== skill))}
              className="rounded p-0.5 text-ink-faint hover:bg-surface-3 hover:text-ink"
              aria-label={t("profile.edit.removeSkill", { skill })}
            >
              <Icon.X className="size-3" />
            </button>
          </span>
        ))}
        <input
          id="skill-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => add(draft)}
          placeholder={value.length ? "" : t("profile.edit.skillsPlaceholder")}
          disabled={value.length >= MAX_SKILLS}
          className="min-w-32 flex-1 bg-transparent px-1 text-sm text-ink placeholder:text-ink-faint focus:outline-none"
        />
      </div>
    </Field>
  );
}

/* ------------------------------------------------------------------ */
/* Work experience                                                      */
/* ------------------------------------------------------------------ */

function WorkEditor({ value, onChange, error }: { value: WorkExperience[]; onChange: (next: WorkExperience[]) => void; error?: string }) {
  const t = useT("account");
  const patch = (id: string, changes: Partial<WorkExperience>) => onChange(value.map((w) => (w.id === id ? { ...w, ...changes } : w)));
  const move = (index: number, dir: -1 | 1) => {
    const next = [...value];
    const target = index + dir;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target]!, next[index]!];
    onChange(next);
  };
  return (
    <div className="space-y-3">
      {error && <p className="text-xs text-danger">{error}</p>}
      {value.length === 0 && <p className="rounded-lg border border-dashed border-border-strong px-3 py-4 text-center text-sm text-ink-muted">{t("profile.edit.noPositions")}</p>}
      {value.map((w, i) => (
        <fieldset key={w.id} className="rounded-xl border border-border p-3 sm:p-4">
          <legend className="sr-only">{t("profile.edit.position", { n: i + 1 })}</legend>
          <div className="mb-3 flex items-center justify-between gap-2">
            <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">{t("profile.edit.position", { n: i + 1 })}</p>
            <div className="flex items-center gap-1">
              <IconButton label={t("profile.edit.moveUp")} size="icon-sm" onClick={() => move(i, -1)} disabled={i === 0}>
                <Icon.ChevronUp className="size-4" />
              </IconButton>
              <IconButton label={t("profile.edit.moveDown")} size="icon-sm" onClick={() => move(i, 1)} disabled={i === value.length - 1}>
                <Icon.ChevronDown className="size-4" />
              </IconButton>
              <IconButton label={t("profile.edit.removePosition")} size="icon-sm" onClick={() => onChange(value.filter((x) => x.id !== w.id))} className="hover:text-danger">
                <Icon.Trash className="size-4" />
              </IconButton>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("profile.edit.jobTitle")} htmlFor={`we-title-${w.id}`} required>
              <Input id={`we-title-${w.id}`} value={w.title} onChange={(e) => patch(w.id, { title: e.target.value })} placeholder={t("profile.edit.jobTitlePlaceholder")} maxLength={120} />
            </Field>
            <Field label={t("profile.edit.company")} htmlFor={`we-company-${w.id}`} required>
              <Input id={`we-company-${w.id}`} value={w.company} onChange={(e) => patch(w.id, { company: e.target.value })} placeholder={t("profile.edit.companyPlaceholder")} maxLength={120} />
            </Field>
            <Field label={t("profile.edit.location")} htmlFor={`we-location-${w.id}`}>
              <Input id={`we-location-${w.id}`} value={w.location ?? ""} onChange={(e) => patch(w.id, { location: e.target.value })} placeholder={t("profile.edit.workLocationPlaceholder")} maxLength={120} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t("profile.edit.start")} htmlFor={`we-start-${w.id}`}>
                <Input id={`we-start-${w.id}`} type="month" value={w.startDate ?? ""} onChange={(e) => patch(w.id, { startDate: e.target.value })} placeholder={t("profile.edit.monthPlaceholder")} />
              </Field>
              <Field label={t("profile.edit.end")} htmlFor={`we-end-${w.id}`}>
                <Input
                  id={`we-end-${w.id}`}
                  type="month"
                  value={w.current ? "" : (w.endDate ?? "")}
                  onChange={(e) => patch(w.id, { endDate: e.target.value })}
                  disabled={!!w.current}
                  placeholder={t("profile.edit.monthPlaceholder")}
                />
              </Field>
            </div>
            <div className="sm:col-span-2">
              <Checkbox
                id={`we-current-${w.id}`}
                checked={!!w.current}
                onChange={(e) => patch(w.id, { current: e.target.checked, endDate: e.target.checked ? undefined : w.endDate })}
                label={t("profile.edit.currentJob")}
              />
            </div>
            <Field label={t("profile.edit.description")} htmlFor={`we-desc-${w.id}`} className="sm:col-span-2">
              <Textarea id={`we-desc-${w.id}`} rows={2} value={w.description ?? ""} onChange={(e) => patch(w.id, { description: e.target.value })} maxLength={1000} placeholder={t("profile.edit.descriptionPlaceholder")} />
            </Field>
          </div>
        </fieldset>
      ))}
      {value.length < 20 && (
        <Button
          variant="outline"
          size="sm"
          leftIcon={<Icon.Plus className="size-4" />}
          onClick={() => onChange([...value, { id: uid("we"), company: "", title: "", current: false }])}
        >
          {t("profile.edit.addPosition")}
        </Button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Education                                                            */
/* ------------------------------------------------------------------ */

function EducationEditor({ value, onChange, error }: { value: EducationDetail[]; onChange: (next: EducationDetail[]) => void; error?: string }) {
  const patch = (id: string, changes: Partial<EducationDetail>) => onChange(value.map((e) => (e.id === id ? { ...e, ...changes } : e)));
  const t = useT("account");
  const yearValue = (n: number | undefined) => (n ? String(n) : "");
  const parseYear = (s: string) => (s ? Number(s.replace(/\D/g, "").slice(0, 4)) || undefined : undefined);
  return (
    <div className="space-y-3">
      {error && <p className="text-xs text-danger">{error}</p>}
      {value.length === 0 && <p className="rounded-lg border border-dashed border-border-strong px-3 py-4 text-center text-sm text-ink-muted">{t("profile.edit.noEducation")}</p>}
      {value.map((e, i) => (
        <fieldset key={e.id} className="rounded-xl border border-border p-3 sm:p-4">
          <legend className="sr-only">{t("profile.edit.educationItem", { n: i + 1 })}</legend>
          <div className="mb-3 flex items-center justify-between gap-2">
            <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">{t("profile.edit.educationItem", { n: i + 1 })}</p>
            <IconButton label={t("profile.edit.removeEducation")} size="icon-sm" onClick={() => onChange(value.filter((x) => x.id !== e.id))} className="hover:text-danger">
              <Icon.Trash className="size-4" />
            </IconButton>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("profile.edit.institution")} htmlFor={`ed-inst-${e.id}`} required className="sm:col-span-2">
              <Input id={`ed-inst-${e.id}`} value={e.institution} onChange={(ev) => patch(e.id, { institution: ev.target.value })} placeholder={t("profile.edit.institutionPlaceholder")} maxLength={120} />
            </Field>
            <Field label={t("profile.edit.degree")} htmlFor={`ed-degree-${e.id}`} required>
              <Input id={`ed-degree-${e.id}`} value={e.degree} onChange={(ev) => patch(e.id, { degree: ev.target.value })} placeholder={t("profile.edit.degreePlaceholder")} maxLength={120} />
            </Field>
            <Field label={t("profile.edit.fieldOfStudy")} htmlFor={`ed-field-${e.id}`}>
              <Input id={`ed-field-${e.id}`} value={e.fieldOfStudy ?? ""} onChange={(ev) => patch(e.id, { fieldOfStudy: ev.target.value })} placeholder={t("profile.edit.fieldOfStudyPlaceholder")} maxLength={120} />
            </Field>
            <Field label={t("profile.edit.startYear")} htmlFor={`ed-start-${e.id}`}>
              <Input id={`ed-start-${e.id}`} inputMode="numeric" value={yearValue(e.startYear)} onChange={(ev) => patch(e.id, { startYear: parseYear(ev.target.value) })} placeholder="2018" maxLength={4} />
            </Field>
            <Field label={t("profile.edit.endYear")} htmlFor={`ed-end-${e.id}`}>
              <Input id={`ed-end-${e.id}`} inputMode="numeric" value={yearValue(e.endYear)} onChange={(ev) => patch(e.id, { endYear: parseYear(ev.target.value) })} placeholder="2022" maxLength={4} />
            </Field>
          </div>
        </fieldset>
      ))}
      {value.length < 20 && (
        <Button variant="outline" size="sm" leftIcon={<Icon.Plus className="size-4" />} onClick={() => onChange([...value, { id: uid("ed"), institution: "", degree: "" }])}>
          {t("profile.edit.addEducation")}
        </Button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Form                                                                 */
/* ------------------------------------------------------------------ */

export function EditProfileForm({ userId, initial, isSelf, backHref }: { userId: string; initial: EditProfileValues; isSelf: boolean; backHref: string }) {
  const [state, action, pending] = useActionState(updateProfileAction, null);
  const t = useT("account");
  const tc = useT("common");
  const f = useFormatter();
  const [values, setValues] = useState<EditProfileValues>(initial);
  const [bioMode, setBioMode] = useState<"write" | "preview">("write");
  const errors = state && !state.ok ? (state.fieldErrors ?? {}) : {};
  const initialJson = useMemo(() => JSON.stringify(initial), [initial]);
  const dirty = JSON.stringify(values) !== initialJson;

  const set = <K extends keyof EditProfileValues>(key: K, value: EditProfileValues[K]) => setValues((v) => ({ ...v, [key]: value }));

  useEffect(() => {
    if (!dirty || pending) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty, pending]);

  return (
    <form action={action} className="space-y-6" noValidate>
      <input type="hidden" name="userId" value={userId} />
      <input type="hidden" name="skills" value={JSON.stringify(values.skills)} />
      <input type="hidden" name="education" value={JSON.stringify(values.education)} />
      <input type="hidden" name="workExperience" value={JSON.stringify(values.workExperience)} />

      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold tracking-tight text-ink">{isSelf ? t("profile.header.editProfile") : t("profile.edit.titleOther", { name: initial.name })}</h2>
          {dirty && (
            <Badge tone="warning" size="sm">
              {t("profile.edit.notSaved")}
            </Badge>
          )}
        </div>
        <div className="flex gap-2">
          <ButtonLink href={backHref} variant="ghost" size="sm">
            {tc("actions.cancel")}
          </ButtonLink>
          <Button type="submit" size="sm" loading={pending} disabled={!dirty && !pending}>
            {tc("actions.save")}
          </Button>
        </div>
      </div>

      <FormError message={state && !state.ok ? state.error : null} />

      <Card>
        <CardHeader title={t("profile.edit.photos")} description={t("profile.edit.photosHint")} />
        <CardBody className="grid gap-6 md:grid-cols-2">
          <div className="flex items-start gap-4">
            <Avatar name={values.name || initial.name} src={values.avatarUrl || null} size="xl" />
            <FileUpload
              className="min-w-0 flex-1"
              name="avatarUrl"
              label={t("profile.edit.profileImage")}
              kind="image"
              accept="image/png,image/jpeg,image/webp"
              value={values.avatarUrl}
              onChange={(url) => set("avatarUrl", url)}
              preview={false}
              hint={errors.avatarUrl ?? t("profile.edit.profileImageHint")}
            />
          </div>
          <FileUpload
            name="coverImageUrl"
            label={t("profile.cover.title")}
            kind="image"
            accept="image/png,image/jpeg,image/webp"
            value={values.coverImageUrl}
            onChange={(url) => set("coverImageUrl", url)}
            hint={errors.coverImageUrl ?? t("profile.edit.coverImageHint")}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("profile.edit.basicInfo")} />
        <CardBody className="grid gap-4 md:grid-cols-2">
          <Field label={t("profile.edit.fullName")} htmlFor="name" required error={errors.name}>
            <Input id="name" name="name" value={values.name} onChange={(e) => set("name", e.target.value)} invalid={!!errors.name} autoComplete="name" maxLength={80} required />
          </Field>
          <Field label={t("profile.edit.username")} htmlFor="username" required error={errors.username} hint={t("profile.edit.usernameHint")}>
            <Input
              id="username"
              name="username"
              value={values.username}
              onChange={(e) => set("username", e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ""))}
              invalid={!!errors.username}
              leftAddon={<span className="text-xs">@</span>}
              autoComplete="username"
              maxLength={40}
              required
            />
          </Field>
          <Field label={t("profile.edit.headline")} htmlFor="headline" error={errors.headline} hint={t("profile.edit.headlineHint")}>
            <Input id="headline" name="headline" value={values.headline} onChange={(e) => set("headline", e.target.value)} invalid={!!errors.headline} maxLength={120} />
          </Field>
          <Field label={t("profile.edit.location")} htmlFor="location" error={errors.location}>
            <Input
              id="location"
              name="location"
              value={values.location}
              onChange={(e) => set("location", e.target.value)}
              invalid={!!errors.location}
              leftAddon={<Icon.MapPin className="size-4" />}
              placeholder={t("profile.edit.locationPlaceholder")}
              maxLength={80}
            />
          </Field>
          <Field
            label={t("profile.edit.openTo")}
            htmlFor="openTo"
            error={errors.openTo}
            hint={t("profile.edit.openToHint")}
          >
            <Select
              id="openTo"
              name="openTo"
              value={values.openTo}
              onChange={(e) => set("openTo", e.target.value === "work" || e.target.value === "hiring" ? e.target.value : "")}
              invalid={!!errors.openTo}
              options={[{ value: "", label: t("profile.edit.openToNone") }, ...openToValues.map((v) => ({ value: v, label: t(`profile.openTo.${v}`) }))]}
            />
          </Field>
          <div className="flex items-end pb-2">
            {values.openTo ? (
              <span className="inline-flex items-center gap-2 text-sm text-ink-muted">
                <span className="relative inline-flex pb-2">
                  <Avatar name={values.name || initial.name} src={values.avatarUrl || null} size="lg" />
                  <OpenToBadge value={values.openTo} overlay size="xs" />
                </span>
                {t("profile.edit.badgePreview")}
              </span>
            ) : (
              <span className="text-sm text-ink-faint">{t("profile.edit.noBadge")}</span>
            )}
          </div>
          <div className="md:col-span-2">
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <label htmlFor="bio" className="text-sm font-medium text-ink">
                {t("profile.edit.bio")}
              </label>
              <SegmentedControl
                size="xs"
                value={bioMode}
                onChange={setBioMode}
                options={[
                  { value: "write", label: t("profile.edit.write") },
                  { value: "preview", label: t("profile.edit.preview") },
                ]}
              />
            </div>
            {bioMode === "write" ? (
              <Textarea
                id="bio"
                name="bio"
                rows={8}
                value={values.bio}
                onChange={(e) => set("bio", e.target.value)}
                invalid={!!errors.bio}
                maxLength={5000}
                placeholder={t("profile.edit.bioPlaceholder")}
              />
            ) : (
              <>
                <input type="hidden" name="bio" value={values.bio} />
                <div className="min-h-48 rounded-lg border border-border bg-surface-2/40 px-4 py-3">
                  {values.bio.trim() ? <Markdown content={values.bio} /> : <p className="text-sm italic text-ink-faint">{t("profile.edit.nothingToPreview")}</p>}
                </div>
              </>
            )}
            {errors.bio ? (
              <p className="mt-1.5 text-xs text-danger">{errors.bio}</p>
            ) : (
              <p className="mt-1.5 text-xs text-ink-muted">{t("profile.edit.bioCount", { count: f.number(values.bio.length), max: f.number(5000) })}</p>
            )}
          </div>
          <div className="md:col-span-2">
            <SkillsInput value={values.skills} onChange={(v) => set("skills", v)} error={errors.skills} />
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("profile.edit.socialLinks")} description={t("profile.edit.socialLinksHint")} />
        <CardBody className="grid gap-4 md:grid-cols-2">
          {socialMeta.map((m) => (
            <Field key={m.key} label={m.key === "website" ? t("global.social.website") : m.label} htmlFor={`social_${m.key}`} error={errors[`social_${m.key}`]}>
              <Input
                id={`social_${m.key}`}
                name={`social_${m.key}`}
                type="url"
                inputMode="url"
                value={values.socials[m.key]}
                onChange={(e) => set("socials", { ...values.socials, [m.key]: e.target.value })}
                invalid={!!errors[`social_${m.key}`]}
                leftAddon={m.icon({ className: "size-4" })}
                placeholder={m.placeholder}
              />
            </Field>
          ))}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("profile.about.work")} description={t("profile.edit.workHint")} />
        <CardBody>
          <WorkEditor value={values.workExperience} onChange={(v) => set("workExperience", v)} error={errors.workExperience} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("profile.about.education")} />
        <CardBody>
          <EducationEditor value={values.education} onChange={(v) => set("education", v)} error={errors.education} />
        </CardBody>
      </Card>

      <div className="sticky bottom-0 z-10 -mx-4 flex items-center justify-between gap-3 border-t border-border bg-surface/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-card sm:border sm:px-5">
        <p className="text-xs text-ink-muted">
          {dirty ? t("profile.edit.unsaved") : t("profile.edit.allSaved")}{" "}
          <Link href={backHref} className="font-medium text-ink hover:underline">
            {t("profile.edit.backToProfile")}
          </Link>
        </p>
        <Button type="submit" loading={pending} disabled={!dirty && !pending}>
          {tc("actions.saveChanges")}
        </Button>
      </div>
    </form>
  );
}
