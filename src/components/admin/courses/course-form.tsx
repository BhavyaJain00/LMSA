"use client";

import Link from "next/link";
import { useActionState, useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { ActionResult, CardGradient, Category, PublicUser } from "@/lib/types";
import { createCategoryAction, createCourseAction, updateCourseAction } from "@/lib/actions/courses";
import { cn, gradientFor, slugify } from "@/lib/utils";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, FormError, Input, Select, Textarea } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import type { CourseFormOptions, CourseFormValues, PickerOption } from "./types";
import { MarkdownEditor } from "./markdown-editor";
import { GradientPicker, ListEditor, MediaField, MultiSelect, TagsInput } from "./form-controls";
import { UnsavedChangesGuard } from "./unsaved-changes-guard";
import { CREATE_MEMBER_OPTION, CreateMemberDialog, memberQualifies, type MemberPurpose } from "./create-member-dialog";

export interface CourseFormProps {
  mode: "create" | "edit";
  courseId?: string;
  initial: CourseFormValues;
  options: CourseFormOptions;
  tagSuggestions: string[];
  /** Show the "saving moves the course back to In progress" note (creators editing a reviewed course). */
  reviewResetNotice?: boolean;
  /** Where "Cancel" goes. */
  cancelHref: string;
  /** Moderators can add a new member straight from the instructor/evaluator pickers. */
  canCreateMembers?: boolean;
  canGrantAdmin?: boolean;
}

/** Order-stable fingerprint of the form values (props may arrive without undefined keys). */
function serialize(v: CourseFormValues): string {
  return JSON.stringify([
    v.title.trim(),
    v.slug.trim(),
    v.shortIntroduction.trim(),
    v.description.trim(),
    v.imageUrl ?? "",
    v.videoUrl ?? "",
    v.cardGradient,
    v.categoryId ?? "",
    v.tags,
    v.instructorIds,
    v.evaluatorId ?? "",
    v.outcomes.map((s) => s.trim()).filter(Boolean),
    v.requirements.map((s) => s.trim()).filter(Boolean),
    v.relatedCourseIds,
  ]);
}

export function CourseForm({ mode, courseId, initial, options, tagSuggestions, reviewResetNotice, cancelHref, canCreateMembers = false, canGrantAdmin = false }: CourseFormProps) {
  const toast = useToast();
  const formRef = useRef<HTMLFormElement>(null);
  const submittedSnapshot = useRef<string>("");

  const [title, setTitle] = useState(initial.title);
  const [slug, setSlug] = useState(initial.slug);
  const [slugTouched, setSlugTouched] = useState(mode === "edit");
  const [shortIntroduction, setShortIntroduction] = useState(initial.shortIntroduction);
  const [description, setDescription] = useState(initial.description);
  const [imageUrl, setImageUrl] = useState(initial.imageUrl ?? "");
  const [videoUrl, setVideoUrl] = useState(initial.videoUrl ?? "");
  const [cardGradient, setCardGradient] = useState<CardGradient>(initial.cardGradient);
  const [categoryId, setCategoryId] = useState(initial.categoryId ?? "");
  const [categories, setCategories] = useState<Category[]>(options.categories);
  const [tags, setTags] = useState(initial.tags);
  const [instructorIds, setInstructorIds] = useState(initial.instructorIds);
  const [evaluatorId, setEvaluatorId] = useState(initial.evaluatorId ?? "");
  const [outcomes, setOutcomes] = useState(initial.outcomes);
  const [requirements, setRequirements] = useState(initial.requirements);
  const [relatedCourseIds, setRelatedCourseIds] = useState(initial.relatedCourseIds);

  const [createdMembers, setCreatedMembers] = useState<PublicUser[]>([]);
  const [memberDialog, setMemberDialog] = useState<{ purpose: MemberPurpose; query: string } | null>(null);
  const instructors = useMemo(() => [...options.instructors, ...createdMembers.filter((u) => memberQualifies(u, "instructor"))], [options.instructors, createdMembers]);
  const evaluators = useMemo(() => [...options.evaluators, ...createdMembers.filter((u) => memberQualifies(u, "evaluator"))], [options.evaluators, createdMembers]);

  const onMemberCreated = (user: PublicUser) => {
    const purpose = memberDialog?.purpose;
    setCreatedMembers((list) => [...list, user]);
    if (purpose === "instructor") setInstructorIds((ids) => (ids.includes(user.id) ? ids : [...ids, user.id]));
    else if (purpose === "evaluator") setEvaluatorId(user.id);
  };

  const [newCategory, setNewCategory] = useState<string | null>(null);
  const [creatingCategory, startCategory] = useTransition();

  const effectiveSlug = slugTouched ? slug : title.trim() ? slugify(title) : "";
  const values: CourseFormValues = {
    title,
    slug: effectiveSlug,
    shortIntroduction,
    description,
    imageUrl: imageUrl || undefined,
    videoUrl: videoUrl || undefined,
    cardGradient,
    categoryId: categoryId || undefined,
    tags,
    instructorIds,
    evaluatorId: evaluatorId || undefined,
    outcomes,
    requirements,
    relatedCourseIds,
  };
  const snapshot = serialize(values);
  const [baseline, setBaseline] = useState(() => serialize(initial));
  const dirty = snapshot !== baseline;

  const [state, formAction, pending] = useActionState(async (prev: ActionResult<unknown> | null, formData: FormData): Promise<ActionResult<unknown> | null> => {
    const result = mode === "create" ? await createCourseAction(null, formData) : await updateCourseAction(null, formData);
    if (!result) return prev;
    if (result.ok) {
      setBaseline(submittedSnapshot.current);
      toast.success(result.message ?? "Course updated successfully");
    } else {
      toast.error(result.error);
    }
    return result;
  }, null);
  const errors = state && !state.ok ? (state.fieldErrors ?? {}) : {};

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        formRef.current?.requestSubmit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const slugTaken = options.takenSlugs.includes(effectiveSlug);
  const slugError = errors.slug ?? (slugTouched && slugTaken ? "This slug is already used by another course." : undefined);
  const slugChanged = mode === "edit" && effectiveSlug !== initial.slug;
  const slugHint = slugChanged
    ? `Changing the slug breaks existing links to /courses/${initial.slug}.`
    : !slugTouched && slugTaken
      ? "A course already uses this slug, so a number will be added when you save."
      : "Used in the course URL. Generated from the title until you edit it.";

  const instructorOptions: PickerOption[] = useMemo(
    () => instructors.map((u) => ({ value: u.id, label: u.name, description: u.email, avatar: { name: u.name, src: u.avatarUrl } })),
    [instructors],
  );
  const relatedOptions: PickerOption[] = useMemo(
    () => options.relatedCourses.map((c) => ({ value: c.id, label: c.title, description: c.published ? `/courses/${c.slug}` : "Unpublished" })),
    [options.relatedCourses],
  );

  const createCategory = () => {
    const name = (newCategory ?? "").trim();
    if (!name) return;
    startCategory(async () => {
      const res = await createCategoryAction(name);
      if (res.ok) {
        setCategories((list) => (list.some((c) => c.id === res.data.id) ? list : [...list, res.data].sort((a, b) => a.name.localeCompare(b.name))));
        setCategoryId(res.data.id);
        setNewCategory(null);
        toast.success(res.message ?? "Category created successfully");
      } else {
        toast.error("Unable to create category", res.error);
      }
    });
  };

  return (
    <form
      ref={formRef}
      action={formAction}
      onSubmit={() => {
        submittedSnapshot.current = snapshot;
      }}
      className="space-y-6"
      noValidate
    >
      <UnsavedChangesGuard dirty={dirty && !pending} />
      {courseId && <input type="hidden" name="courseId" value={courseId} />}
      {(mode === "edit" || slugTouched) && <input type="hidden" name="slug" value={effectiveSlug} />}
      <FormError message={state && !state.ok ? state.error : null} />
      {reviewResetNotice && (
        <div className="flex items-start gap-3 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5 text-sm text-ink">
          <Icon.AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
          <p>Saving changes moves this course back to <strong>In progress</strong>. Submit it for review again once you are done editing.</p>
        </div>
      )}

      <Card>
        <CardHeader title="Course details" description="The basics learners see on the catalog card and course page." />
        <CardBody className="grid gap-5 md:grid-cols-2">
          <Field label="Title" htmlFor="course-title" required error={errors.title} className="md:col-span-2">
            <Input
              id="course-title"
              name="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoComplete="off"
              maxLength={140}
              placeholder="e.g. Modern JavaScript Fundamentals"
              invalid={!!errors.title}
              required
            />
          </Field>
          <Field label="Slug" htmlFor="course-slug" error={slugError} hint={slugHint} className="md:col-span-2">
            <div className="flex">
              <span className="inline-flex items-center rounded-l-lg border border-r-0 border-border-strong bg-surface-2 px-3 text-sm text-ink-muted">/courses/</span>
              <Input
                id="course-slug"
                value={effectiveSlug}
                onChange={(e) => {
                  setSlugTouched(true);
                  setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-{2,}/g, "-"));
                }}
                onBlur={() => setSlug((s) => (s.trim() ? slugify(s) : title.trim() ? slugify(title) : ""))}
                placeholder="generated-from-the-title"
                className="rounded-l-none"
                invalid={!!slugError}
                maxLength={80}
              />
            </div>
          </Field>
          <Field
            label="Short introduction"
            htmlFor="course-intro"
            required
            error={errors.shortIntroduction}
            hint={`${shortIntroduction.length}/300 · One or two sentences shown on course cards.`}
            className="md:col-span-2"
          >
            <Textarea
              id="course-intro"
              name="shortIntroduction"
              rows={2}
              value={shortIntroduction}
              onChange={(e) => setShortIntroduction(e.target.value)}
              maxLength={300}
              placeholder="Type something"
              invalid={!!errors.shortIntroduction}
            />
          </Field>
          <Field label="Category" htmlFor="course-category" error={errors.categoryId}>
            <div className="flex gap-2">
              <div className="min-w-0 flex-1">
                <Select id="course-category" name="categoryId" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} invalid={!!errors.categoryId}>
                  <option value="">Select category</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </div>
              <Button variant="outline" size="icon" onClick={() => setNewCategory(newCategory === null ? "" : null)} aria-label="Create a new category" title="New category">
                <Icon.Plus className="size-4" />
              </Button>
            </div>
            {newCategory !== null && (
              <div className="mt-2 flex gap-2">
                <Input
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value)}
                  placeholder="Category name"
                  aria-label="New category name"
                  autoFocus
                  maxLength={50}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      createCategory();
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      setNewCategory(null);
                    }
                  }}
                />
                <Button size="md" variant="secondary" onClick={createCategory} loading={creatingCategory} disabled={!newCategory.trim()}>
                  Create
                </Button>
              </div>
            )}
          </Field>
          <Field label="Tags" htmlFor="course-tags" error={errors.tags}>
            <TagsInput id="course-tags" name="tags" value={tags} onChange={setTags} suggestions={tagSuggestions} invalid={!!errors.tags} />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Course description" description="The long-form overview on the course page. Markdown is supported." />
        <CardBody>
          <Field htmlFor="course-description" error={errors.description} required>
            <MarkdownEditor
              id="course-description"
              name="description"
              value={description}
              onChange={setDescription}
              rows={12}
              invalid={!!errors.description}
              ariaLabel="Course description"
              placeholder={"## What you'll learn\n\nDescribe the course, who it is for and how it works…"}
            />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Media" description="A cover image and a short promo video make the course page stand out." />
        <CardBody className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-4">
            <Field label="Course thumbnail" error={errors.imageUrl}>
              <MediaField
                name="imageUrl"
                kind="image"
                accept="image/png,image/jpeg,image/gif,image/webp"
                value={imageUrl}
                onChange={setImageUrl}
                invalid={!!errors.imageUrl}
                hint="Upload a 750×422 image (.jpg, .jpeg, .gif, or .png). Shown on the catalog card and lesson hero."
              />
            </Field>
            <div>
              <p className="mb-1.5 text-sm font-medium text-ink">Color</p>
              <GradientPicker name="cardGradient" value={cardGradient} onChange={setCardGradient} />
              <p className="mt-1.5 text-xs text-ink-muted">{imageUrl ? "Remove the image to use the color on the card." : "Used on the course card when there is no thumbnail."}</p>
            </div>
          </div>
          <div className="space-y-4">
            <div>
              <p className="mb-1.5 text-sm font-medium text-ink">Card preview</p>
              <div className="relative aspect-[750/422] w-full max-w-sm overflow-hidden rounded-xl border border-border">
                {imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={imageUrl} alt="" className="size-full object-cover" />
                ) : (
                  <div className={cn("flex size-full items-end bg-gradient-to-tr p-4", gradientFor(cardGradient))}>
                    <p className="line-clamp-3 text-xl font-extrabold leading-tight text-white drop-shadow">{title || "Course title"}</p>
                  </div>
                )}
              </div>
            </div>
            <Field label="Preview video" error={errors.videoUrl}>
              <MediaField
                name="videoUrl"
                kind="video"
                value={videoUrl}
                onChange={setVideoUrl}
                invalid={!!errors.videoUrl}
                urlPlaceholder="https://example.com/intro.mp4"
                hint="Self-hosted MP4/WebM or a direct video file URL. YouTube and Vimeo links are not supported."
              />
            </Field>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Instructors & evaluation" />
        <CardBody className="grid gap-5 md:grid-cols-2">
          <Field label="Instructors" htmlFor="course-instructors" required error={errors.instructorIds} hint="Instructors can edit this course and see its dashboard.">
            <MultiSelect
              id="course-instructors"
              name="instructorIds"
              options={instructorOptions}
              value={instructorIds}
              onChange={setInstructorIds}
              placeholder="Select instructors"
              searchPlaceholder="Search instructors…"
              emptyText="No course creators match your search"
              invalid={!!errors.instructorIds}
              onCreate={canCreateMembers ? (query) => setMemberDialog({ purpose: "instructor", query }) : undefined}
              createLabel="Add New Member"
            />
          </Field>
          <Field label="Evaluator" htmlFor="course-evaluator" error={errors.evaluatorId} hint="Grades certificate evaluations for this course.">
            <Select
              id="course-evaluator"
              name="evaluatorId"
              value={evaluatorId}
              onChange={(e) => {
                if (e.target.value === CREATE_MEMBER_OPTION) setMemberDialog({ purpose: "evaluator", query: "" });
                else setEvaluatorId(e.target.value);
              }}
              invalid={!!errors.evaluatorId}
            >
              <option value="">No evaluator</option>
              {evaluators.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} ({u.email})
                </option>
              ))}
              {canCreateMembers && <option value={CREATE_MEMBER_OPTION}>+ Add New Member…</option>}
            </Select>
          </Field>
        </CardBody>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="What learners will learn" description="Shown as a checklist on the course page." />
          <CardBody>
            <ListEditor name="outcomes" label="Outcome" value={outcomes} onChange={setOutcomes} placeholder="e.g. Write asynchronous code with async/await" addLabel="Add outcome" invalid={!!errors.outcomes} />
            {errors.outcomes && <p className="mt-2 text-xs text-danger">{errors.outcomes}</p>}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Requirements" description="What learners should know or have before starting." />
          <CardBody>
            <ListEditor
              name="requirements"
              label="Requirement"
              value={requirements}
              onChange={setRequirements}
              placeholder="e.g. A computer with a modern browser"
              addLabel="Add requirement"
              invalid={!!errors.requirements}
            />
            {errors.requirements && <p className="mt-2 text-xs text-danger">{errors.requirements}</p>}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader title="Related courses" description="Suggested on the course page. Only published courses are shown to learners." />
        <CardBody>
          <Field htmlFor="course-related" error={errors.relatedCourseIds}>
            <MultiSelect
              id="course-related"
              name="relatedCourseIds"
              options={relatedOptions}
              value={relatedCourseIds}
              onChange={setRelatedCourseIds}
              placeholder="Select related courses"
              searchPlaceholder="Search courses…"
              emptyText="No other courses available"
              max={12}
              invalid={!!errors.relatedCourseIds}
            />
          </Field>
        </CardBody>
      </Card>

      <div className="sticky bottom-0 z-20 -mx-4 border-t border-border bg-surface-1/95 backdrop-blur sm:-mx-6 lg:-mx-8">
        <div className="flex items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <div className="min-w-0 text-sm">
            {dirty ? (
              <Badge tone="warning" dot>
                Not Saved
              </Badge>
            ) : (
              <span className="hidden text-ink-muted sm:inline">{mode === "edit" ? "All changes saved" : "Fill in the details and save to create the course"}</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <ButtonLink href={cancelHref} variant="ghost">
              {mode === "create" ? "Cancel" : "Back"}
            </ButtonLink>
            <Button type="submit" loading={pending} disabled={mode === "edit" && !dirty} title={mode === "edit" && !dirty ? "No changes to save" : "Save (Ctrl+S)"} leftIcon={<Icon.Check className="size-4" />}>
              {mode === "create" ? "Create course" : "Save"}
            </Button>
          </div>
        </div>
      </div>
      {mode === "create" && (
        <p className="text-center text-xs text-ink-muted">
          After saving you can set pricing and visibility, then build the outline. Want to reuse an existing course?{" "}
          <Link href="/admin/courses/import" className="font-medium text-accent hover:underline">
            Import from JSON
          </Link>
        </p>
      )}
      <CreateMemberDialog
        open={memberDialog !== null}
        onClose={() => setMemberDialog(null)}
        purpose={memberDialog?.purpose ?? "instructor"}
        initialQuery={memberDialog?.query}
        canGrantAdmin={canGrantAdmin}
        onCreated={onMemberCreated}
      />
    </form>
  );
}
