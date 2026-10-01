"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import type { CourseSalesPage, SalesSection } from "@/lib/types";
import { removeSalesPageAction, saveSalesPageAction } from "@/lib/actions/sales-page";
import {
  FEATURE_ICONS,
  SALES_LIMITS,
  SALES_SECTION_TYPES,
  SALES_SEO_LIMITS,
  addableSectionTypes,
  emptySalesPage,
  hasSalesPage,
  moveItem,
  salesPageTemplate,
  type SalesSectionType,
  type SalesTemplateInput,
} from "@/lib/seo/sales-page";
import { DESCRIPTION_MAX, DESCRIPTION_MIN, TITLE_MAX, TITLE_MIN, applyTitleTemplate, metaDescription } from "@/lib/seo/text";
import { MarkdownEditor } from "@/components/admin/courses/markdown-editor";
import { SaveBar } from "@/components/admin/settings/save-bar";
import { SettingsSection } from "@/components/admin/settings/settings-ui";
import { useFormAction } from "@/components/admin/settings/use-form-action";
import { FaqEditor } from "@/components/blog/admin/faq-editor";
import { TestimonialsEditor } from "@/components/marketing/sales/testimonials-editor";
import { CharCounter } from "@/components/seo/char-counter";
import { SnippetPreview } from "@/components/seo/snippet-preview";
import { Button, ButtonLink, IconButton } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Dropdown } from "@/components/ui/dropdown";
import { FileUpload } from "@/components/ui/file-upload";
import { Icon } from "@/components/ui/icons";
import { Field, FormError, Input, Select, Switch, Textarea } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";

export interface SalesPageEditorProps {
  course: SalesTemplateInput & { id: string; slug: string; description: string };
  initial: CourseSalesPage | null;
  seo: { seoTitle: string; metaDescription: string; ogImageUrl: string };
  /** Canonical origin for the snippet preview. */
  origin: string;
  titleTemplate: string;
}

/** Icon shown next to each section type in the list and the "Add section" menu. */
const SECTION_ICON: Record<SalesSectionType, keyof typeof Icon> = {
  text: "FileText",
  features: "ListChecks",
  curriculum: "BookOpen",
  instructor: "User",
  testimonials: "MessageSquare",
  faq: "Question",
  pricing: "Tag",
  video: "Video",
  cta: "Megaphone",
};

/** What fills the sections whose content comes from the course itself. */
const AUTO_CONTENT: Partial<Record<SalesSectionType, string>> = {
  curriculum: "Shows the course outline: chapters, lessons, durations and free previews.",
  instructor: "Shows the instructors with their bio and teaching stats.",
  testimonials: "Shows the quotes from the Testimonials panel below.",
  faq: "Shows the questions from the FAQ panel below.",
  pricing: "Shows the price, what is included, the guarantee and an enroll button.",
  video: "Plays the course's preview video (set it in the course details).",
};

/** ISO → value of a `datetime-local` input in the browser's time zone. */
function toLocalInput(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(value: string): string | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

function newSectionId(): string {
  return `sec_${Math.random().toString(36).slice(2, 10)}`;
}

function sectionLabel(type: SalesSectionType): string {
  return SALES_SECTION_TYPES.find((t) => t.type === type)?.label ?? type;
}

/**
 * Sales page builder of a course: hero headline and subheadline, ordered
 * sections (text, what you get, curriculum, instructor, testimonials, FAQ,
 * pricing, video, call to action) that can be added, reordered and removed,
 * the testimonial and FAQ editors, the guarantee, an optional offer
 * countdown, and the page's SEO title, meta description and share image with
 * a live search-result preview. Starts from a template built from the course
 * when nothing is saved yet.
 */
export function SalesPageEditor({ course, initial, seo, origin, titleTemplate }: SalesPageEditorProps) {
  const id = useId();
  const router = useRouter();
  const toast = useToast();
  const [page, setPage] = useState<CourseSalesPage>(() => initial ?? emptySalesPage());
  const [started, setStarted] = useState(() => !!initial);
  const [countdown, setCountdown] = useState(() => toLocalInput(initial?.countdownEndsAt));
  const [seoTitle, setSeoTitle] = useState(seo.seoTitle);
  const [description, setDescription] = useState(seo.metaDescription);
  const [ogImage, setOgImage] = useState(seo.ogImageUrl);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, startRemove] = useTransition();
  // Reference time for the "this date has passed" hint (refreshed whenever the date changes).
  const [now, setNow] = useState(() => Date.now());

  const { onSubmit, pending, errors, formError, dirty, markDirty, state } = useFormAction(saveSalesPageAction, { onSuccess: () => router.refresh() });

  const change = (patch: Partial<CourseSalesPage>) => {
    setPage((prev) => ({ ...prev, ...patch }));
    markDirty();
  };
  const setSections = (sections: SalesSection[]) => change({ sections });
  const updateSection = (index: number, patch: Partial<SalesSection>) => setSections(page.sections.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  const addSection = (type: SalesSectionType) => {
    const section: SalesSection = { id: newSectionId(), type, title: sectionLabel(type) };
    if (type === "features") section.items = [{ title: "", icon: "CheckCircle" }];
    setSections([...page.sections, section]);
    toast.success(`${sectionLabel(type)} section added at the end.`);
  };

  const applyTemplate = () => {
    const template = salesPageTemplate(course);
    setPage(template);
    setCountdown("");
    setStarted(true);
    markDirty();
  };

  const remove = () =>
    startRemove(async () => {
      const result = await removeSalesPageAction(course.id);
      setConfirmRemove(false);
      if (result.ok) {
        toast.success(result.message ?? "Removed");
        setPage(emptySalesPage());
        setStarted(false);
        router.refresh();
      } else toast.error(result.error);
    });

  const addable = addableSectionTypes(page.sections);
  const countdownIso = fromLocalInput(countdown);
  const countdownPast = !!countdownIso && Date.parse(countdownIso) <= now;
  const payload: CourseSalesPage = { ...page, countdownEndsAt: countdownIso };
  const coursePath = `/courses/${course.slug}`;
  const documentTitle = applyTitleTemplate(titleTemplate, seoTitle.trim() || course.title);
  const previewDescription = description.trim() || metaDescription(course.shortIntroduction, course.description);

  if (!started) {
    return (
      <EmptyState
        icon={<Icon.Layout />}
        title="No sales page yet"
        description="The course page uses the standard layout. Build a landing page with a strong headline, benefits, testimonials, FAQ, a guarantee and an optional offer countdown."
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Button onClick={applyTemplate} leftIcon={<Icon.Sparkles className="size-4" />}>
              Start from a template
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setStarted(true);
                change({ heroHeadline: course.title });
              }}
            >
              Start blank
            </Button>
          </div>
        }
      />
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <input type="hidden" name="courseId" value={course.id} />
      <input type="hidden" name="page" value={JSON.stringify(payload)} />
      <FormError message={formError && !Object.keys(errors).length ? formError : null} />

      {!hasSalesPage(page) && (
        <p className="mb-4 flex items-start gap-2 rounded-lg border border-info/30 bg-info/10 px-3 py-2 text-sm text-ink">
          <Icon.Info className="mt-0.5 size-4 shrink-0 text-info" aria-hidden="true" />
          Add a headline or at least one section: until then the course page keeps its standard layout.
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-6">
          <SettingsSection title="Hero" description="The first thing visitors see, next to the enroll card.">
            <div className="space-y-4 p-4 sm:p-5">
              <Field label="Headline" htmlFor={`${id}-headline`} hint="The promise of the course in one line. Shown as the page's main heading." error={errors.heroHeadline}>
                <Input
                  id={`${id}-headline`}
                  value={page.heroHeadline ?? ""}
                  maxLength={SALES_LIMITS.headline}
                  placeholder={course.title}
                  className="text-base font-medium"
                  onChange={(e) => change({ heroHeadline: e.target.value })}
                />
              </Field>
              <Field label="Subheadline" htmlFor={`${id}-sub`} hint="Who it is for and what they will be able to do.">
                <Textarea
                  id={`${id}-sub`}
                  value={page.heroSubheadline ?? ""}
                  rows={2}
                  maxLength={SALES_LIMITS.subheadline}
                  placeholder={course.shortIntroduction}
                  onChange={(e) => change({ heroSubheadline: e.target.value })}
                />
              </Field>
              <Switch
                checked={page.showStats}
                onChange={(e) => change({ showStats: e.target.checked })}
                label="Show course stats"
                description="Rating, number of learners, lessons and total length under the headline."
              />
            </div>
          </SettingsSection>

          <SettingsSection
            title="Sections"
            description="Shown in this order under the hero. Reviews and related courses always follow."
            actions={
              addable.length > 0 ? (
                <Dropdown
                  trigger={
                    <span className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border-strong bg-surface-1 px-3 text-sm font-medium text-ink hover:bg-surface-2">
                      <Icon.Plus className="size-4" aria-hidden="true" />
                      Add section
                    </span>
                  }
                  items={addable.map((type) => {
                    const SectionIcon = Icon[SECTION_ICON[type]];
                    return {
                      label: sectionLabel(type),
                      description: SALES_SECTION_TYPES.find((t) => t.type === type)?.description,
                      icon: <SectionIcon />,
                      onClick: () => addSection(type),
                    };
                  })}
                />
              ) : undefined
            }
          >
            <div className="p-4 sm:p-5">
              {page.sections.length === 0 ? (
                <p className="text-sm text-ink-muted">No sections yet. Use “Add section” to build the page.</p>
              ) : (
                <ol className="space-y-3">
                  {page.sections.map((section, index) => (
                    <SectionCard
                      key={section.id}
                      section={section}
                      index={index}
                      count={page.sections.length}
                      hasVideo={course.hasVideo}
                      onChange={(patch) => updateSection(index, patch)}
                      onMove={(delta) => setSections(moveItem(page.sections, index, delta))}
                      onRemove={() => setSections(page.sections.filter((_, i) => i !== index))}
                    />
                  ))}
                </ol>
              )}
            </div>
          </SettingsSection>

          <SettingsSection title="Testimonials" description="Quotes shown by the Testimonials section.">
            <div className="p-4 sm:p-5">
              <TestimonialsEditor items={page.testimonials} onChange={(testimonials) => change({ testimonials })} error={errors.testimonials} />
            </div>
          </SettingsSection>

          <SettingsSection title="Frequently asked questions" description="Shown by the FAQ section and marked up for rich results.">
            <div className="p-4 sm:p-5">
              <FaqEditor items={page.faq} onChange={(faq) => change({ faq })} error={errors.faq} />
            </div>
          </SettingsSection>

          <SettingsSection title="Search and sharing" description="How the course page appears in Google and in link previews.">
            <div className="space-y-4 p-4 sm:p-5">
              <SnippetPreview url={`${origin}${coursePath}`} title={documentTitle} description={previewDescription} />
              <Field label="SEO title" htmlFor={`${id}-seo-title`} error={errors.seoTitle} hint="Empty: the course title is used.">
                <Input
                  id={`${id}-seo-title`}
                  name="seoTitle"
                  value={seoTitle}
                  maxLength={SALES_SEO_LIMITS.seoTitle + 20}
                  placeholder={course.title}
                  invalid={!!errors.seoTitle}
                  onChange={(e) => {
                    setSeoTitle(e.target.value);
                    markDirty();
                  }}
                />
                <CharCounter length={documentTitle.length} min={TITLE_MIN} max={TITLE_MAX} />
              </Field>
              <Field label="Meta description" htmlFor={`${id}-meta`} error={errors.metaDescription} hint="Empty: generated from the short introduction.">
                <Textarea
                  id={`${id}-meta`}
                  name="metaDescription"
                  value={description}
                  rows={3}
                  maxLength={SALES_SEO_LIMITS.metaDescription + 40}
                  placeholder={previewDescription}
                  invalid={!!errors.metaDescription}
                  onChange={(e) => {
                    setDescription(e.target.value);
                    markDirty();
                  }}
                />
                <CharCounter length={description.trim().length} min={DESCRIPTION_MIN} max={DESCRIPTION_MAX} />
              </Field>
              <div>
                <p className="mb-1.5 text-sm font-medium text-ink">Share image</p>
                <FileUpload
                  kind="image"
                  name="ogImageUrl"
                  value={ogImage}
                  onChange={(url) => {
                    setOgImage(url);
                    markDirty();
                  }}
                  hint="1200×630. Empty: a card with the course title, instructor and rating is generated."
                />
                {errors.ogImageUrl && <p className="mt-1.5 text-xs text-danger">{errors.ogImageUrl}</p>}
                {ogImage && (
                  <Button
                    size="xs"
                    variant="ghost"
                    className="mt-2"
                    onClick={() => {
                      setOgImage("");
                      markDirty();
                    }}
                  >
                    Use the generated card
                  </Button>
                )}
              </div>
            </div>
          </SettingsSection>
        </div>

        <div className="min-w-0 space-y-6">
          <SettingsSection title="Offer">
            <div className="space-y-4 p-4">
              <Field label="Guarantee" htmlFor={`${id}-guarantee`} hint="Shown with the price, e.g. “30-day money-back guarantee, no questions asked.” Markdown allowed.">
                <Textarea id={`${id}-guarantee`} value={page.guarantee ?? ""} rows={3} maxLength={SALES_LIMITS.guarantee} onChange={(e) => change({ guarantee: e.target.value })} />
              </Field>
              <Field
                label="Offer ends"
                htmlFor={`${id}-countdown`}
                error={errors.countdownEndsAt}
                hint={countdownPast ? "This time has passed: the countdown is hidden." : "Optional. Shows a live countdown in the hero and the pricing section. Your local time."}
              >
                <Input
                  id={`${id}-countdown`}
                  type="datetime-local"
                  value={countdown}
                  invalid={!!errors.countdownEndsAt}
                  suppressHydrationWarning
                  onChange={(e) => {
                    setCountdown(e.target.value);
                    setNow(Date.now());
                    markDirty();
                  }}
                />
              </Field>
              {countdown && (
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => {
                    setCountdown("");
                    markDirty();
                  }}
                >
                  Remove the countdown
                </Button>
              )}
            </div>
          </SettingsSection>

          <SettingsSection title="Start over">
            <div className="space-y-3 p-4 text-sm text-ink-muted">
              <p>Replace everything above with a fresh page built from the course&apos;s outcomes, outline and instructors.</p>
              <Button size="sm" variant="outline" onClick={applyTemplate} leftIcon={<Icon.Sparkles className="size-4" />}>
                Apply the template
              </Button>
            </div>
          </SettingsSection>
        </div>
      </div>

      <SaveBar
        dirty={dirty}
        pending={pending}
        saved={state?.ok}
        failed={state?.ok === false}
        label="Save sales page"
        requireDirty={!!initial}
        extra={
          <>
            <ButtonLink href={coursePath} variant="ghost" size="sm" leftIcon={<Icon.Eye className="size-4" />}>
              View course page
            </ButtonLink>
            {initial && (
              <Button variant="ghost" size="sm" className="text-danger" onClick={() => setConfirmRemove(true)} leftIcon={<Icon.Trash className="size-4" />}>
                Remove
              </Button>
            )}
          </>
        }
      />

      <ConfirmDialog
        open={confirmRemove}
        onClose={() => (removing ? undefined : setConfirmRemove(false))}
        onConfirm={remove}
        loading={removing}
        destructive
        title="Remove the sales page?"
        description="The course page goes back to the standard layout. Sections, testimonials, FAQ, guarantee and countdown are deleted; the SEO title, description and share image are kept."
        confirmLabel="Remove"
      />
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* One section                                                         */
/* ------------------------------------------------------------------ */

function SectionCard({
  section,
  index,
  count,
  hasVideo,
  onChange,
  onMove,
  onRemove,
}: {
  section: SalesSection;
  index: number;
  count: number;
  hasVideo: boolean;
  onChange: (patch: Partial<SalesSection>) => void;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
}) {
  const id = useId();
  const label = sectionLabel(section.type);
  const SectionIcon = Icon[SECTION_ICON[section.type]];
  const items = section.items ?? [];
  const setItems = (next: NonNullable<SalesSection["items"]>) => onChange({ items: next });
  const auto = AUTO_CONTENT[section.type];

  return (
    <li className="rounded-xl border border-border bg-surface-1">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
          <SectionIcon className="size-4" aria-hidden="true" />
        </span>
        <p className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
          <span className="text-ink-muted tabular-nums">{index + 1}.</span> {label}
        </p>
        <IconButton label={`Move ${label} section up`} size="icon-sm" disabled={index === 0} onClick={() => onMove(-1)}>
          <Icon.ChevronUp className="size-4" />
        </IconButton>
        <IconButton label={`Move ${label} section down`} size="icon-sm" disabled={index === count - 1} onClick={() => onMove(1)}>
          <Icon.ChevronDown className="size-4" />
        </IconButton>
        <IconButton label={`Remove ${label} section`} size="icon-sm" onClick={onRemove}>
          <Icon.Trash className="size-4 text-danger" />
        </IconButton>
      </div>
      <div className="space-y-3 p-3">
        <Field label="Heading" htmlFor={`${id}-title`}>
          <Input id={`${id}-title`} value={section.title ?? ""} maxLength={SALES_LIMITS.title} placeholder={label} onChange={(e) => onChange({ title: e.target.value })} />
        </Field>

        {section.type === "text" && (
          <div>
            <label htmlFor={`${id}-body`} className="mb-1.5 block text-sm font-medium text-ink">
              Text
            </label>
            <MarkdownEditor id={`${id}-body`} value={section.body ?? ""} onChange={(body) => onChange({ body })} rows={8} placeholder="Tell the story of the course: the problem, the approach, the result." />
          </div>
        )}

        {section.type === "cta" && (
          <Field label="Pitch" htmlFor={`${id}-body`} hint="One or two sentences above the enroll button. Markdown allowed.">
            <Textarea id={`${id}-body`} value={section.body ?? ""} rows={2} maxLength={SALES_LIMITS.itemBody} onChange={(e) => onChange({ body: e.target.value })} />
          </Field>
        )}

        {section.type === "features" && (
          <fieldset className="space-y-2">
            <legend className="mb-1 text-sm font-medium text-ink">Items</legend>
            {items.map((item, i) => (
              <div key={i} className="rounded-lg border border-border bg-surface-2/40 p-2.5">
                <div className="flex items-start gap-2">
                  <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-[9rem_minmax(0,1fr)]">
                    <div>
                      <label htmlFor={`${id}-icon-${i}`} className="sr-only">
                        Icon of item {i + 1}
                      </label>
                      <Select id={`${id}-icon-${i}`} value={item.icon ?? ""} onChange={(e) => setItems(items.map((it, j) => (j === i ? { ...it, icon: e.target.value || undefined } : it)))}>
                        <option value="">No icon</option>
                        {FEATURE_ICONS.map((name) => (
                          <option key={name} value={name}>
                            {name.replace(/([a-z])([A-Z])/g, "$1 $2")}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <div>
                      <label htmlFor={`${id}-item-${i}`} className="sr-only">
                        Title of item {i + 1}
                      </label>
                      <Input
                        id={`${id}-item-${i}`}
                        value={item.title}
                        maxLength={SALES_LIMITS.itemTitle}
                        placeholder="Benefit, e.g. Build 5 real projects"
                        onChange={(e) => setItems(items.map((it, j) => (j === i ? { ...it, title: e.target.value } : it)))}
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label htmlFor={`${id}-itembody-${i}`} className="sr-only">
                        Details of item {i + 1}
                      </label>
                      <Textarea
                        id={`${id}-itembody-${i}`}
                        value={item.body ?? ""}
                        rows={2}
                        maxLength={SALES_LIMITS.itemBody}
                        placeholder="Details (optional)"
                        onChange={(e) => setItems(items.map((it, j) => (j === i ? { ...it, body: e.target.value } : it)))}
                      />
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col gap-1">
                    <IconButton label={`Move item ${i + 1} up`} size="icon-sm" disabled={i === 0} onClick={() => setItems(moveItem(items, i, -1))}>
                      <Icon.ChevronUp className="size-4" />
                    </IconButton>
                    <IconButton label={`Move item ${i + 1} down`} size="icon-sm" disabled={i === items.length - 1} onClick={() => setItems(moveItem(items, i, 1))}>
                      <Icon.ChevronDown className="size-4" />
                    </IconButton>
                    <IconButton label={`Remove item ${i + 1}`} size="icon-sm" onClick={() => setItems(items.filter((_, j) => j !== i))}>
                      <Icon.X className="size-4" />
                    </IconButton>
                  </div>
                </div>
              </div>
            ))}
            <Button size="xs" variant="outline" disabled={items.length >= SALES_LIMITS.items} onClick={() => setItems([...items, { title: "", icon: "CheckCircle" }])} leftIcon={<Icon.Plus className="size-3.5" />}>
              Add item
            </Button>
          </fieldset>
        )}

        {auto && (
          <p className="flex items-start gap-1.5 text-xs text-ink-muted">
            <Icon.Info className="mt-px size-3.5 shrink-0" aria-hidden="true" />
            {auto}
            {section.type === "video" && !hasVideo && <span className="font-medium text-warning"> This course has no preview video yet, so the section is hidden.</span>}
          </p>
        )}
      </div>
    </li>
  );
}
