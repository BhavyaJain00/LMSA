"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { createCategoryAction, deleteCategoryAction, updateCategoryAction } from "@/lib/actions/categories";
import { Button, IconButton } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Icon } from "@/components/ui/icons";
import { Table, TBody, TD, TH, THead, TR, TableEmpty } from "@/components/ui/table";
import { ConfirmDialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { suggestSlug } from "@/lib/seo/text";
import { CategoryLandingDialog } from "@/components/seo/admin/category-landing-dialog";
import { SlugSuggestion } from "@/components/seo/slug-suggestion";
import { useFormAction } from "./use-form-action";
import { useT } from "@/i18n/client";

export interface CategoryRowData {
  id: string;
  name: string;
  slug: string;
  courseCount: number;
  batchCount: number;
  /** Landing page text (`/courses/category/<slug>`). */
  intro: string;
  seoTitle: string;
  seoDescription: string;
}

export function CategoriesManager({ categories, siteUrl, brandName }: { categories: CategoryRowData[]; siteUrl: string; brandName: string }) {
  const t = useT("admin");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [landing, setLanding] = useState<CategoryRowData | null>(null);
  const [toDelete, setToDelete] = useState<CategoryRowData | null>(null);
  const [deleting, startDelete] = useTransition();
  const toast = useToast();

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? categories.filter((c) => c.name.toLowerCase().includes(q) || c.slug.includes(q)) : categories;
  }, [categories, search]);

  const confirmDelete = () => {
    const target = toDelete;
    if (!target) return;
    startDelete(async () => {
      const res = await deleteCategoryAction(target.id);
      if (res.ok) {
        toast.success(res.message ?? t("categories.deleted"), res.data.unlinked ? t("categories.unlinked", { count: res.data.unlinked }) : undefined);
        setToDelete(null);
      } else {
        toast.error(res.error);
      }
    });
  };

  return (
    <div className="space-y-5">
      <NewCategoryForm />

      {categories.length === 0 ? (
        <EmptyState icon={<Icon.Tag />} title={t("categories.emptyTitle")} description={t("categories.emptyDescription")} />
      ) : (
        <>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="w-full sm:max-w-xs">
              <Input
                type="search"
                aria-label={t("categories.searchLabel")}
                placeholder={t("shared.search")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                leftAddon={<Icon.Search className="size-4" />}
              />
            </div>
            <p className="text-xs text-ink-muted">{t("categories.count", { count: categories.length })}</p>
          </div>
          <Table>
            <THead>
              <tr>
                <TH>{t("categories.columns.category")}</TH>
                <TH className="hidden sm:table-cell">{t("categories.columns.slug")}</TH>
                <TH className="hidden md:table-cell">{t("categories.columns.usedBy")}</TH>
                <TH className="w-32 text-end">
                  <span className="sr-only">{t("shared.actions")}</span>
                </TH>
              </tr>
            </THead>
            <TBody>
              {filtered.length === 0 ? (
                <TableEmpty colSpan={4}>{t("categories.noMatch", { query: search })}</TableEmpty>
              ) : (
                filtered.map((c) =>
                  editing === c.id ? (
                    <EditCategoryRow key={c.id} category={c} onDone={() => setEditing(null)} />
                  ) : (
                    <TR key={c.id}>
                      <TD>
                        <p className="font-medium">{c.name}</p>
                        <p className="font-mono text-xs text-ink-muted sm:hidden">/{c.slug}</p>
                        {!c.intro && c.courseCount > 0 && <p className="mt-0.5 text-xs text-ink-faint">{t("categories.noIntro")}</p>}
                      </TD>
                      <TD className="hidden font-mono text-xs text-ink-muted sm:table-cell">{c.slug}</TD>
                      <TD className="hidden text-ink-muted md:table-cell">
                        {c.courseCount + c.batchCount === 0 ? (
                          <span className="text-ink-faint">{t("categories.notUsed")}</span>
                        ) : (
                          <>
                            {t("categories.usage", { courses: c.courseCount, batches: c.batchCount })}
                          </>
                        )}
                      </TD>
                      <TD className="text-end">
                        <div className="flex justify-end gap-1">
                          <IconButton label={t("categories.editLanding", { name: c.name })} size="icon-sm" onClick={() => setLanding(c)}>
                            <Icon.Globe className="size-4" />
                          </IconButton>
                          <IconButton label={t("shared.editNamed", { name: c.name })} size="icon-sm" onClick={() => setEditing(c.id)}>
                            <Icon.Edit className="size-4" />
                          </IconButton>
                          <IconButton label={t("shared.deleteNamed", { name: c.name })} size="icon-sm" className="hover:text-danger" onClick={() => setToDelete(c)}>
                            <Icon.Trash className="size-4" />
                          </IconButton>
                        </div>
                      </TD>
                    </TR>
                  ),
                )
              )}
            </TBody>
          </Table>
        </>
      )}

      <ConfirmDialog
        open={!!toDelete}
        onClose={() => (deleting ? undefined : setToDelete(null))}
        onConfirm={confirmDelete}
        loading={deleting}
        destructive
        title={t("categories.deleteTitle")}
        description={t("categories.deleteDescription")}
        confirmLabel={t("shared.delete")}
      />

      {landing && <CategoryLandingDialog key={landing.id} category={landing} siteUrl={siteUrl} brandName={brandName} onClose={() => setLanding(null)} />}
    </div>
  );
}

function NewCategoryForm() {
  const t = useT("admin");
  const formRef = useRef<HTMLFormElement>(null);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const { onSubmit, pending, errors } = useFormAction(createCategoryAction, {
    onSuccess: () => {
      setName("");
      setSlug("");
      setSlugTouched(false);
    },
  });

  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate className="rounded-card border border-border bg-surface-1 p-4 shadow-card">
      <p className="mb-3 text-sm font-semibold text-ink">{t("categories.new")}</p>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-start">
        <div>
          <label htmlFor="new-category-name" className="sr-only">
            {t("categories.name")}
          </label>
          <Input
            id="new-category-name"
            name="name"
            placeholder={t("categories.namePlaceholder")}
            value={name}
            maxLength={60}
            onChange={(e) => {
              setName(e.target.value);
              if (!slugTouched) setSlug(e.target.value.trim() ? suggestSlug(e.target.value) : "");
            }}
            invalid={!!errors.name}
            required
          />
          {errors.name && <p className="mt-1 text-xs text-danger">{errors.name}</p>}
        </div>
        <div>
          <label htmlFor="new-category-slug" className="sr-only">
            {t("categories.columns.slug")}
          </label>
          <Input
            id="new-category-slug"
            name="slug"
            placeholder={t("categories.slugPlaceholder")}
            value={slug}
            onChange={(e) => {
              setSlug(e.target.value);
              setSlugTouched(true);
            }}
            className="font-mono"
            leftAddon={<span className="text-xs">/</span>}
            invalid={!!errors.slug}
          />
          {errors.slug ? <p className="mt-1 text-xs text-danger">{errors.slug}</p> : <p className="mt-1 text-xs text-ink-muted">{t.rich("categories.address", { path: <span dir="ltr">/courses/category/{slug || "…"}</span> })}</p>}
        </div>
        <Button type="submit" loading={pending} leftIcon={<Icon.Plus className="size-4" />} disabled={!name.trim()}>
          {t("categories.create")}
        </Button>
      </div>
    </form>
  );
}

function EditCategoryRow({ category, onDone }: { category: CategoryRowData; onDone: () => void }) {
  const t = useT("admin");
  const [name, setName] = useState(category.name);
  const [slug, setSlug] = useState(category.slug);
  const { onSubmit, pending, errors, dirty, markDirty } = useFormAction(updateCategoryAction, { onSuccess: onDone });
  return (
    <tr className="bg-accent/5">
      <td colSpan={4} className="px-4 py-3">
        <form onSubmit={onSubmit} onChange={markDirty} noValidate className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-start">
          <input type="hidden" name="id" value={category.id} />
          <div>
            <label htmlFor={`name-${category.id}`} className="mb-1 block text-xs font-medium text-ink-muted">
              {t("categories.name")}
            </label>
            <Input id={`name-${category.id}`} name="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} invalid={!!errors.name} autoFocus />
            {errors.name && <p className="mt-1 text-xs text-danger">{errors.name}</p>}
          </div>
          <div>
            <label htmlFor={`slug-${category.id}`} className="mb-1 block text-xs font-medium text-ink-muted">
              {t("categories.columns.slug")}
            </label>
            <Input id={`slug-${category.id}`} name="slug" value={slug} onChange={(e) => setSlug(e.target.value)} className="font-mono" invalid={!!errors.slug} />
            {errors.slug && <p className="mt-1 text-xs text-danger">{errors.slug}</p>}
            <SlugSuggestion
              title={name}
              slug={slug}
              basePath="/courses/category/"
              originalSlug={category.slug}
              onApply={(next) => {
                setSlug(next);
                markDirty();
              }}
            />
          </div>
          <div className="flex gap-2 sm:pt-5">
            <Button type="submit" size="sm" loading={pending} disabled={!dirty}>
              {t("shared.save")}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={onDone} disabled={pending}>
              {t("shared.cancel")}
            </Button>
          </div>
        </form>
      </td>
    </tr>
  );
}
