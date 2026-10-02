"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useMemo, useState, useTransition } from "react";
import type { BlogPostStatus, FaqItem } from "@/lib/types";
import type { PostEditorOptions } from "@/lib/data/blog";
import { deletePostAction, savePostAction } from "@/lib/actions/blog";
import { POST_LIMITS, autoExcerpt, normalizeTags, postReadingTime } from "@/lib/seo/blog";
import { analyzeSeo } from "@/lib/seo/focus-keyword";
import { applyTitleTemplate, metaDescription, suggestSlug, wordCount } from "@/lib/seo/text";
import { MarkdownEditor } from "@/components/admin/courses/markdown-editor";
import { SaveBar } from "@/components/admin/settings/save-bar";
import { SettingsSection } from "@/components/admin/settings/settings-ui";
import { useFormAction } from "@/components/admin/settings/use-form-action";
import { SlugSuggestion } from "@/components/seo/slug-suggestion";
import { Button, ButtonLink } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { FileUpload } from "@/components/ui/file-upload";
import { Icon } from "@/components/ui/icons";
import { Checkbox, Field, FormError, Input, RadioCard, Select, Switch, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { FaqEditor } from "./faq-editor";
import { SeoPanel } from "./seo-panel";
import { useT } from "@/i18n/client";

/* Rendered through `./post-editor.tsx`, which provides the `blogAdmin.` messages on the admin pages. */

export interface PostEditorValues {
  id?: string;
  title: string;
  slug: string;
  excerpt: string;
  content: string;
  coverImageUrl: string;
  categoryIds: string[];
  tags: string[];
  relatedCourseIds: string[];
  faq: FaqItem[];
  seoTitle: string;
  seoDescription: string;
  canonicalUrl: string;
  focusKeyword: string;
  noindex: boolean;
  status: BlogPostStatus;
  publishedAt?: string;
  authorId: string;
}

/** ISO → value of a `datetime-local` input in the browser's time zone. */
function toLocalInput(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** `datetime-local` value (browser time zone) → ISO, or "" when empty/invalid. */
function fromLocalInput(value: string): string {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

const STATUS_OPTIONS = [
  { value: "draft", label: "blogAdmin.status.draft", description: "blogAdmin.editor.statusDraftHint" },
  { value: "published", label: "blogAdmin.status.published", description: "blogAdmin.editor.statusPublishedHint" },
  { value: "scheduled", label: "blogAdmin.status.scheduled", description: "blogAdmin.editor.statusScheduledHint" },
] as const satisfies readonly { value: BlogPostStatus; label: string; description: string }[];

/**
 * Article editor: title, slug (with suggestion and redirect note), excerpt,
 * Markdown body with image upload, FAQ, SEO panel (snippet preview,
 * counters, focus-keyword checks), publishing (draft / publish / schedule),
 * cover, categories, topics, related courses, author, noindex and canonical
 * override. Saves through `savePostAction`; deleting asks for confirmation.
 */
export function PostEditor({
  post,
  options,
  origin,
  titleTemplate,
  blogEnabled,
}: {
  post: PostEditorValues | null;
  options: PostEditorOptions;
  origin: string;
  titleTemplate: string;
  blogEnabled: boolean;
}) {
  const t = useT("public");
  const common = useT("common");
  const id = useId();
  const router = useRouter();
  const toast = useToast();
  const isNew = !post?.id;

  const [title, setTitle] = useState(post?.title ?? "");
  const [slug, setSlug] = useState(post?.slug ?? "");
  const [excerpt, setExcerpt] = useState(post?.excerpt ?? "");
  const [content, setContent] = useState(post?.content ?? "");
  const [cover, setCover] = useState(post?.coverImageUrl ?? "");
  const [categoryIds, setCategoryIds] = useState<string[]>(post?.categoryIds ?? []);
  const [tags, setTags] = useState((post?.tags ?? []).join(", "));
  const [courseIds, setCourseIds] = useState<string[]>(post?.relatedCourseIds ?? []);
  const [courseFilter, setCourseFilter] = useState("");
  const [faq, setFaq] = useState<FaqItem[]>(post?.faq ?? []);
  const [seoTitle, setSeoTitle] = useState(post?.seoTitle ?? "");
  const [seoDescription, setSeoDescription] = useState(post?.seoDescription ?? "");
  const [focusKeyword, setFocusKeyword] = useState(post?.focusKeyword ?? "");
  const [status, setStatus] = useState<BlogPostStatus>(post?.status ?? "draft");
  const [when, setWhen] = useState(() => toLocalInput(post?.publishedAt));
  const [inlineImage, setInlineImage] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Reference time for the "this date has passed" hint (refreshed whenever the date changes).
  const [now, setNow] = useState(() => Date.now());
  const [deleting, startDelete] = useTransition();

  const { onSubmit, pending, errors, formError, dirty, markDirty, state } = useFormAction(savePostAction, {
    onSuccess: (result) => {
      if (isNew) router.replace(`/admin/blog/${result.data.id}`);
      else router.refresh();
    },
  });

  // Live SEO analysis of what the page will publish.
  const effectiveSlug = slug.trim() || (title.trim() ? suggestSlug(title) : "");
  const documentTitle = applyTitleTemplate(titleTemplate, seoTitle.trim() || title.trim());
  const previewDescription = seoDescription.trim() || metaDescription(excerpt, content);
  const checks = useMemo(
    () => analyzeSeo({ keyword: focusKeyword, seoTitle: documentTitle, h1: title, content, slug: effectiveSlug, metaDescription: seoDescription }),
    [focusKeyword, documentTitle, title, content, effectiveSlug, seoDescription],
  );
  const words = wordCount(content);

  const set =
    <T,>(setter: (v: T) => void) =>
    (value: T) => {
      setter(value);
      markDirty();
    };

  const toggleIn = (list: string[], value: string, on: boolean) => (on ? [...list, value] : list.filter((v) => v !== value));

  const insertImage = (url: string) => {
    if (!url) return;
    const alt = title.trim() ? t("blogAdmin.editor.imageAlt", { title: title.trim() }) : t("blogAdmin.editor.imageAltFallback");
    setContent((prev) => `${prev.replace(/\s*$/, "")}\n\n![${alt}](${url})\n`);
    setInlineImage("");
    markDirty();
    toast.success(t("blogAdmin.editor.imageAdded"));
  };

  const remove = () =>
    startDelete(async () => {
      if (!post?.id) return;
      const result = await deletePostAction(post.id);
      if (result.ok) {
        toast.success(result.message ?? t("blogAdmin.deleted"));
        router.push("/admin/blog");
      } else {
        toast.error(result.error);
        setConfirmDelete(false);
      }
    });

  const filteredCourses = courseFilter.trim()
    ? options.courses.filter((c) => c.title.toLowerCase().includes(courseFilter.trim().toLowerCase()) || courseIds.includes(c.id))
    : options.courses;
  const tagPreview = normalizeTags(tags);
  const scheduleInPast = status === "scheduled" && !!when && Date.parse(fromLocalInput(when)) <= now;
  const saveLabel =
    status === "draft"
      ? t("blogAdmin.editor.saveDraft")
      : status === "scheduled"
        ? scheduleInPast
          ? t("blogAdmin.editor.publish")
          : t("blogAdmin.editor.schedule")
        : post?.status === "published"
          ? t("blogAdmin.editor.update")
          : t("blogAdmin.editor.publish");
  const minutes = Math.max(1, Math.round(postReadingTime(content) / 60));

  return (
    <form onSubmit={onSubmit} onChange={markDirty} noValidate>
      {post?.id && <input type="hidden" name="id" value={post.id} />}
      <input type="hidden" name="status" value={status} />
      <input type="hidden" name="publishedAt" value={fromLocalInput(when)} />
      <input type="hidden" name="faq" value={JSON.stringify(faq.filter((f) => f.question.trim() || f.answer.trim()))} />
      {categoryIds.map((c) => (
        <input key={c} type="hidden" name="categoryIds" value={c} />
      ))}
      {courseIds.map((c) => (
        <input key={c} type="hidden" name="relatedCourseIds" value={c} />
      ))}

      <FormError message={formError && !Object.keys(errors).length ? formError : null} />

      <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-6">
          <SettingsSection title={t("blogAdmin.editor.article")}>
            <div className="space-y-5 p-4 sm:p-5">
              <Field label={t("blogAdmin.editor.title")} htmlFor={`${id}-title`} required error={errors.title}>
                <Input
                  id={`${id}-title`}
                  name="title"
                  value={title}
                  maxLength={POST_LIMITS.title}
                  placeholder={t("blogAdmin.editor.titlePlaceholder")}
                  invalid={!!errors.title}
                  className="text-base font-medium"
                  onChange={(e) => set(setTitle)(e.target.value)}
                  autoFocus={isNew}
                />
              </Field>
              <Field label={t("blogAdmin.editor.slug")} htmlFor={`${id}-slug`} error={errors.slug}>
                <Input
                  id={`${id}-slug`}
                  name="slug"
                  value={slug}
                  placeholder={title ? suggestSlug(title) : "article-address"}
                  dir="ltr"
                  className="font-mono"
                  autoComplete="off"
                  spellCheck={false}
                  invalid={!!errors.slug}
                  onChange={(e) => set(setSlug)(e.target.value.toLowerCase())}
                />
                <SlugSuggestion title={title} slug={slug} onApply={set(setSlug)} basePath="/blog/" originalSlug={post?.status === "published" ? post.slug : undefined} />
              </Field>
              <Field
                label={t("blogAdmin.editor.excerpt")}
                htmlFor={`${id}-excerpt`}
                error={errors.excerpt}
                hint={excerpt ? t("blogAdmin.editor.charCount", { length: excerpt.length, max: POST_LIMITS.excerpt }) : t("blogAdmin.editor.excerptHint")}
              >
                <Textarea
                  id={`${id}-excerpt`}
                  name="excerpt"
                  value={excerpt}
                  rows={2}
                  maxLength={POST_LIMITS.excerpt}
                  placeholder={content ? autoExcerpt(content, 160) : t("blogAdmin.editor.excerptPlaceholder")}
                  invalid={!!errors.excerpt}
                  onChange={(e) => set(setExcerpt)(e.target.value)}
                />
              </Field>
              <div>
                <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2">
                  <label htmlFor={`${id}-content`} className="text-sm font-medium text-ink">
                    {t("blogAdmin.editor.content")} <span className="text-danger">*</span>
                  </label>
                  <p className="text-xs text-ink-muted" aria-live="polite">
                    {t("blogAdmin.editor.wordCount", { count: words })} · {t("blog.readingTime", { minutes })}
                  </p>
                </div>
                <MarkdownEditor
                  id={`${id}-content`}
                  name="content"
                  value={content}
                  onChange={set(setContent)}
                  rows={22}
                  invalid={!!errors.content}
                  describedBy={errors.content ? `${id}-content-error` : `${id}-content-hint`}
                  placeholder={t("blogAdmin.editor.contentPlaceholder")}
                />
                {errors.content ? (
                  <p id={`${id}-content-error`} className="mt-1.5 text-xs text-danger">
                    {errors.content}
                  </p>
                ) : (
                  <p id={`${id}-content-hint`} className="mt-1.5 text-xs text-ink-muted">
                    {t("blogAdmin.editor.contentHint")}
                  </p>
                )}
                <details className="mt-3 rounded-xl border border-border px-3 py-2">
                  <summary className="cursor-pointer text-sm font-medium text-ink">
                    <Icon.Image className="me-1.5 inline size-4 text-ink-muted" aria-hidden="true" />
                    {t("blogAdmin.editor.uploadImage")}
                  </summary>
                  <div className="mt-3">
                    <FileUpload kind="image" value={inlineImage} onChange={(url) => insertImage(url)} hint={t("blogAdmin.editor.uploadImageHint")} />
                  </div>
                </details>
              </div>
            </div>
          </SettingsSection>

          <SettingsSection title={t("blog.faq.title")} description={t("blogAdmin.editor.faqDescription")}>
            <div className="p-4 sm:p-5">
              <FaqEditor items={faq} onChange={set(setFaq)} error={errors.faq} />
            </div>
          </SettingsSection>

          <SettingsSection title={t("blogAdmin.editor.seo")} description={t("blogAdmin.editor.seoDescription")}>
            <div className="p-4 sm:p-5">
              <SeoPanel
                url={`${origin}/blog/${effectiveSlug || "…"}`}
                documentTitle={documentTitle}
                fallbackTitle={title}
                seoTitle={seoTitle}
                onSeoTitle={set(setSeoTitle)}
                seoDescription={seoDescription}
                onSeoDescription={set(setSeoDescription)}
                previewDescription={previewDescription}
                focusKeyword={focusKeyword}
                onFocusKeyword={set(setFocusKeyword)}
                checks={checks}
                errors={errors}
              />
            </div>
          </SettingsSection>
        </div>

        <div className="min-w-0 space-y-6">
          <SettingsSection title={t("blogAdmin.editor.publishing")}>
            <div className="space-y-3 p-4">
              {!blogEnabled && <p className="rounded-lg bg-warning/10 px-3 py-2 text-xs text-ink">{t("blogAdmin.editor.blogOff")}</p>}
              <fieldset className="space-y-2">
                <legend className="sr-only">{t("blogAdmin.table.status")}</legend>
                {STATUS_OPTIONS.map((option) => (
                  <RadioCard
                    key={option.value}
                    name={`${id}-status`}
                    value={option.value}
                    checked={status === option.value}
                    onChange={() => {
                      setNow(Date.now());
                      set(setStatus)(option.value);
                    }}
                    title={t(option.label)}
                    description={t(option.description)}
                  />
                ))}
              </fieldset>
              {(status === "scheduled" || when) && (
                <Field
                  label={status === "scheduled" ? t("blogAdmin.editor.goesLive") : status === "published" ? t("blogAdmin.editor.publicationDate") : t("blogAdmin.editor.plannedDate")}
                  htmlFor={`${id}-when`}
                  error={errors.publishedAt}
                  hint={scheduleInPast ? t("blogAdmin.editor.datePassed") : t("blogAdmin.editor.localTime")}
                >
                  <Input
                    id={`${id}-when`}
                    type="datetime-local"
                    value={when}
                    onChange={(e) => {
                      setNow(Date.now());
                      set(setWhen)(e.target.value);
                    }} invalid={!!errors.publishedAt} suppressHydrationWarning />
                </Field>
              )}
              {status !== "scheduled" && !when && (
                <button type="button" className="text-xs font-medium text-accent hover:underline" onClick={() => set(setWhen)(toLocalInput(new Date().toISOString()))}>
                  {t("blogAdmin.editor.setDate")}
                </button>
              )}
              {options.authors.length > 0 && (
                <Field label={t("blogAdmin.editor.author")} htmlFor={`${id}-author`} error={errors.authorId}>
                  <Select id={`${id}-author`} name="authorId" defaultValue={post?.authorId} invalid={!!errors.authorId}>
                    {options.authors.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
            </div>
          </SettingsSection>

          <SettingsSection title={t("blogAdmin.editor.cover")}>
            <div className="p-4">
              <FileUpload kind="image" name="coverImageUrl" value={cover} onChange={(url) => set(setCover)(url)} hint={t("blogAdmin.editor.coverHint")} />
              {errors.coverImageUrl && <p className="mt-1.5 text-xs text-danger">{errors.coverImageUrl}</p>}
              {cover && (
                <Button type="button" size="xs" variant="ghost" className="mt-2" onClick={() => set(setCover)("")}>
                  {t("blogAdmin.editor.removeCover")}
                </Button>
              )}
            </div>
          </SettingsSection>

          <SettingsSection title={t("blogAdmin.editor.categoriesAndTopics")}>
            <div className="space-y-4 p-4">
              <fieldset>
                <legend className="mb-1.5 text-sm font-medium text-ink">{t("blogAdmin.editor.categories")}</legend>
                {options.categories.length ? (
                  <div className="max-h-52 space-y-1.5 overflow-y-auto pe-1">
                    {options.categories.map((c) => (
                      <Checkbox
                        key={c.id}
                        id={`${id}-cat-${c.id}`}
                        label={c.name}
                        checked={categoryIds.includes(c.id)}
                        disabled={!categoryIds.includes(c.id) && categoryIds.length >= POST_LIMITS.categories}
                        onChange={(e) => set(setCategoryIds)(toggleIn(categoryIds, c.id, e.target.checked))}
                      />
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-ink-muted">
                    {t.rich("blogAdmin.editor.noCategories", {
                      link: (chunks) => (
                        <Link href="/admin/settings/categories" className="text-accent hover:underline">
                          {chunks}
                        </Link>
                      ),
                    })}
                  </p>
                )}
                {errors.categoryIds && <p className="mt-1.5 text-xs text-danger">{errors.categoryIds}</p>}
              </fieldset>
              <Field label={t("blogAdmin.editor.topics")} htmlFor={`${id}-tags`} hint={t("blogAdmin.editor.topicsHint", { max: POST_LIMITS.tags })}>
                <Input id={`${id}-tags`} name="tags" value={tags} placeholder={t("blogAdmin.editor.topicsPlaceholder")} onChange={(e) => set(setTags)(e.target.value)} />
                {tagPreview.length > 0 && (
                  <ul className="mt-2 flex flex-wrap gap-1.5" aria-label={t("blogAdmin.editor.topics")}>
                    {tagPreview.map((tag) => (
                      <li key={tag} className="rounded-full bg-surface-3 px-2 py-0.5 text-xs text-ink">
                        {tag}
                      </li>
                    ))}
                  </ul>
                )}
              </Field>
            </div>
          </SettingsSection>

          <SettingsSection title={t("blogAdmin.editor.relatedCourses")} description={t("blogAdmin.editor.relatedCoursesHint")}>
            <div className="space-y-2 p-4">
              {options.courses.length > 6 && (
                <Input type="search" value={courseFilter} onChange={(e) => setCourseFilter(e.target.value)} placeholder={t("blogAdmin.editor.findCourse")} aria-label={t("blogAdmin.editor.findCourse")} leftAddon={<Icon.Search className="size-4" />} />
              )}
              {options.courses.length ? (
                <div className="max-h-60 space-y-1.5 overflow-y-auto pe-1">
                  {filteredCourses.map((c) => (
                    <Checkbox
                      key={c.id}
                      id={`${id}-course-${c.id}`}
                      label={c.published ? c.title : t("blogAdmin.editor.courseUnpublished", { title: c.title })}
                      checked={courseIds.includes(c.id)}
                      disabled={!courseIds.includes(c.id) && courseIds.length >= POST_LIMITS.relatedCourses}
                      onChange={(e) => set(setCourseIds)(toggleIn(courseIds, c.id, e.target.checked))}
                    />
                  ))}
                  {filteredCourses.length === 0 && <p className="text-xs text-ink-muted">{t("blogAdmin.editor.noCourseMatch", { search: courseFilter })}</p>}
                </div>
              ) : (
                <p className="text-xs text-ink-muted">{t("blogAdmin.editor.noCourses")}</p>
              )}
              {errors.relatedCourseIds && <p className="text-xs text-danger">{errors.relatedCourseIds}</p>}
            </div>
          </SettingsSection>

          <SettingsSection title={t("blogAdmin.editor.indexing")}>
            <div className="space-y-4 p-4">
              <Switch
                name="noindex"
                defaultChecked={post?.noindex}
                label={t("blogAdmin.editor.noindex")}
                description={t("blogAdmin.editor.noindexHint")}
              />
              <Field
                label={t("blogAdmin.editor.canonical")}
                htmlFor={`${id}-canonical`}
                error={errors.canonicalUrl}
                hint={t("blogAdmin.editor.canonicalHint")}
              >
                <Input id={`${id}-canonical`} name="canonicalUrl" type="url" defaultValue={post?.canonicalUrl} placeholder="https://" dir="ltr" invalid={!!errors.canonicalUrl} />
              </Field>
            </div>
          </SettingsSection>
        </div>
      </div>

      <SaveBar
        dirty={dirty}
        pending={pending}
        saved={state?.ok}
        failed={state?.ok === false}
        label={saveLabel}
        requireDirty={!isNew}
        extra={
          post?.id ? (
            <>
              <ButtonLink href={`/blog/${post.slug}`} variant="ghost" size="sm" leftIcon={<Icon.Eye className="size-4" />}>
                {post.status === "published" ? t("blogAdmin.view") : t("blogAdmin.preview")}
              </ButtonLink>
              <Button variant="ghost" size="sm" className="text-danger" onClick={() => setConfirmDelete(true)} leftIcon={<Icon.Trash className="size-4" />}>
                {common("actions.delete")}
              </Button>
            </>
          ) : undefined
        }
      />

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => (deleting ? undefined : setConfirmDelete(false))}
        onConfirm={remove}
        loading={deleting}
        destructive
        title={post?.title ? t("blogAdmin.deleteOne", { title: post.title }) : t("blogAdmin.deleteThis")}
        description={t("blogAdmin.editor.deleteDescription")}
        confirmLabel={common("actions.delete")}
      />
    </form>
  );
}
