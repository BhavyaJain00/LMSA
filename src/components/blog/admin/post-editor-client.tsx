"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useMemo, useState, useTransition } from "react";
import type { BlogPostStatus, FaqItem } from "@/lib/types";
import type { PostEditorOptions } from "@/lib/data/blog";
import { deletePostAction, savePostAction } from "@/lib/actions/blog";
import { POST_LIMITS, autoExcerpt, normalizeTags, postReadingTime } from "@/lib/seo/blog";
import { analyzeSeo } from "@/lib/seo/focus-keyword";
import { applyTitleTemplate, metaDescription, readingTimeLabel, suggestSlug, wordCount } from "@/lib/seo/text";
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

const STATUS_OPTIONS: { value: BlogPostStatus; label: string; description: string }[] = [
  { value: "draft", label: "Draft", description: "Only editors can see it." },
  { value: "published", label: "Published", description: "Live on the blog now." },
  { value: "scheduled", label: "Scheduled", description: "Goes live at the date you pick." },
];

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
    const alt = title.trim() ? `Illustration for ${title.trim()}` : "Image";
    setContent((prev) => `${prev.replace(/\s*$/, "")}\n\n![${alt}](${url})\n`);
    setInlineImage("");
    markDirty();
    toast.success("Image added at the end of the article. Move it where it belongs and adjust the alt text.");
  };

  const remove = () =>
    startDelete(async () => {
      if (!post?.id) return;
      const result = await deletePostAction(post.id);
      if (result.ok) {
        toast.success(result.message ?? "Deleted");
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
    status === "draft" ? "Save draft" : status === "scheduled" ? (scheduleInPast ? "Publish" : "Schedule") : post?.status === "published" ? "Update" : "Publish";

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
          <SettingsSection title="Article">
            <div className="space-y-5 p-4 sm:p-5">
              <Field label="Title" htmlFor={`${id}-title`} required error={errors.title}>
                <Input
                  id={`${id}-title`}
                  name="title"
                  value={title}
                  maxLength={POST_LIMITS.title}
                  placeholder="A clear, specific headline"
                  invalid={!!errors.title}
                  className="text-base font-medium"
                  onChange={(e) => set(setTitle)(e.target.value)}
                  autoFocus={isNew}
                />
              </Field>
              <Field label="Slug" htmlFor={`${id}-slug`} error={errors.slug}>
                <Input
                  id={`${id}-slug`}
                  name="slug"
                  value={slug}
                  placeholder={title ? suggestSlug(title) : "article-address"}
                  className="font-mono"
                  autoComplete="off"
                  spellCheck={false}
                  invalid={!!errors.slug}
                  onChange={(e) => set(setSlug)(e.target.value.toLowerCase())}
                />
                <SlugSuggestion title={title} slug={slug} onApply={set(setSlug)} basePath="/blog/" originalSlug={post?.status === "published" ? post.slug : undefined} />
              </Field>
              <Field label="Excerpt" htmlFor={`${id}-excerpt`} error={errors.excerpt} hint={excerpt ? `${excerpt.length}/${POST_LIMITS.excerpt}` : "Shown on article cards and under the title. Empty: taken from the first paragraph."}>
                <Textarea
                  id={`${id}-excerpt`}
                  name="excerpt"
                  value={excerpt}
                  rows={2}
                  maxLength={POST_LIMITS.excerpt}
                  placeholder={content ? autoExcerpt(content, 160) : "One or two sentences that sum up the article."}
                  invalid={!!errors.excerpt}
                  onChange={(e) => set(setExcerpt)(e.target.value)}
                />
              </Field>
              <div>
                <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2">
                  <label htmlFor={`${id}-content`} className="text-sm font-medium text-ink">
                    Content <span className="text-danger">*</span>
                  </label>
                  <p className="text-xs text-ink-muted" aria-live="polite">
                    {words} {words === 1 ? "word" : "words"} · {readingTimeLabel(postReadingTime(content))}
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
                  placeholder={"Start with a short introduction that mentions what the reader will learn.\n\n## First section\n\nUse ## and ### headings: they build the table of contents."}
                />
                {errors.content ? (
                  <p id={`${id}-content-error`} className="mt-1.5 text-xs text-danger">
                    {errors.content}
                  </p>
                ) : (
                  <p id={`${id}-content-hint`} className="mt-1.5 text-xs text-ink-muted">
                    Markdown. H2 and H3 headings become the table of contents (shown from three headings).
                  </p>
                )}
                <details className="mt-3 rounded-xl border border-border px-3 py-2">
                  <summary className="cursor-pointer text-sm font-medium text-ink">
                    <Icon.Image className="me-1.5 inline size-4 text-ink-muted" aria-hidden="true" />
                    Upload an image into the article
                  </summary>
                  <div className="mt-3">
                    <FileUpload kind="image" value={inlineImage} onChange={(url) => insertImage(url)} hint="PNG, JPG, WebP or GIF. The image is added at the end of the article as Markdown." />
                  </div>
                </details>
              </div>
            </div>
          </SettingsSection>

          <SettingsSection title="Frequently asked questions" description="Shown under the article and marked up for rich results.">
            <div className="p-4 sm:p-5">
              <FaqEditor items={faq} onChange={set(setFaq)} error={errors.faq} />
            </div>
          </SettingsSection>

          <SettingsSection title="Search engine optimisation" description="How the article appears in Google and how well it targets its keyword.">
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
          <SettingsSection title="Publishing">
            <div className="space-y-3 p-4">
              {!blogEnabled && <p className="rounded-lg bg-warning/10 px-3 py-2 text-xs text-ink">The blog is switched off: published articles become public once it is turned on.</p>}
              <fieldset className="space-y-2">
                <legend className="sr-only">Status</legend>
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
                    title={option.label}
                    description={option.description}
                  />
                ))}
              </fieldset>
              {(status === "scheduled" || when) && (
                <Field
                  label={status === "scheduled" ? "Goes live on" : status === "published" ? "Publication date" : "Planned date"}
                  htmlFor={`${id}-when`}
                  error={errors.publishedAt}
                  hint={scheduleInPast ? "This time has passed: the article is published when you save." : "Your local time."}
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
                  Set a date
                </button>
              )}
              {options.authors.length > 0 && (
                <Field label="Author" htmlFor={`${id}-author`} error={errors.authorId}>
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

          <SettingsSection title="Cover image">
            <div className="p-4">
              <FileUpload kind="image" name="coverImageUrl" value={cover} onChange={(url) => set(setCover)(url)} hint="1200×630 or wider works best for cards and sharing." />
              {errors.coverImageUrl && <p className="mt-1.5 text-xs text-danger">{errors.coverImageUrl}</p>}
              {cover && (
                <Button type="button" size="xs" variant="ghost" className="mt-2" onClick={() => set(setCover)("")}>
                  Remove cover
                </Button>
              )}
            </div>
          </SettingsSection>

          <SettingsSection title="Categories and topics">
            <div className="space-y-4 p-4">
              <fieldset>
                <legend className="mb-1.5 text-sm font-medium text-ink">Categories</legend>
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
                    No categories yet. <Link href="/admin/settings/categories" className="text-accent hover:underline">Create categories</Link> to group articles with courses.
                  </p>
                )}
                {errors.categoryIds && <p className="mt-1.5 text-xs text-danger">{errors.categoryIds}</p>}
              </fieldset>
              <Field label="Topics" htmlFor={`${id}-tags`} hint={`Comma separated, up to ${POST_LIMITS.tags}.`}>
                <Input id={`${id}-tags`} name="tags" value={tags} placeholder="javascript, beginners, career" onChange={(e) => set(setTags)(e.target.value)} />
                {tagPreview.length > 0 && (
                  <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Topics">
                    {tagPreview.map((t) => (
                      <li key={t} className="rounded-full bg-surface-3 px-2 py-0.5 text-xs text-ink">
                        {t}
                      </li>
                    ))}
                  </ul>
                )}
              </Field>
            </div>
          </SettingsSection>

          <SettingsSection title="Related courses" description="Promoted under the article and linked from those courses' pages.">
            <div className="space-y-2 p-4">
              {options.courses.length > 6 && (
                <Input type="search" value={courseFilter} onChange={(e) => setCourseFilter(e.target.value)} placeholder="Find a course" aria-label="Find a course" leftAddon={<Icon.Search className="size-4" />} />
              )}
              {options.courses.length ? (
                <div className="max-h-60 space-y-1.5 overflow-y-auto pe-1">
                  {filteredCourses.map((c) => (
                    <Checkbox
                      key={c.id}
                      id={`${id}-course-${c.id}`}
                      label={c.published ? c.title : `${c.title} (not published)`}
                      checked={courseIds.includes(c.id)}
                      disabled={!courseIds.includes(c.id) && courseIds.length >= POST_LIMITS.relatedCourses}
                      onChange={(e) => set(setCourseIds)(toggleIn(courseIds, c.id, e.target.checked))}
                    />
                  ))}
                  {filteredCourses.length === 0 && <p className="text-xs text-ink-muted">No course matches “{courseFilter}”.</p>}
                </div>
              ) : (
                <p className="text-xs text-ink-muted">No courses yet.</p>
              )}
              {errors.relatedCourseIds && <p className="text-xs text-danger">{errors.relatedCourseIds}</p>}
            </div>
          </SettingsSection>

          <SettingsSection title="Indexing">
            <div className="space-y-4 p-4">
              <Switch
                name="noindex"
                defaultChecked={post?.noindex}
                label="Hide from search engines"
                description="Adds noindex and leaves the article out of the sitemap. Visitors with the link can still read it."
              />
              <Field
                label="Canonical URL"
                htmlFor={`${id}-canonical`}
                error={errors.canonicalUrl}
                hint="Only for articles first published elsewhere: search engines credit that address instead."
              >
                <Input id={`${id}-canonical`} name="canonicalUrl" type="url" defaultValue={post?.canonicalUrl} placeholder="https://" invalid={!!errors.canonicalUrl} />
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
                {post.status === "published" ? "View" : "Preview"}
              </ButtonLink>
              <Button variant="ghost" size="sm" className="text-danger" onClick={() => setConfirmDelete(true)} leftIcon={<Icon.Trash className="size-4" />}>
                Delete
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
        title={`Delete “${post?.title ?? "this article"}”?`}
        description="Deleted articles cannot be restored. The address stops working and search engines are told the page is gone."
        confirmLabel="Delete"
      />
    </form>
  );
}
