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
import { pluralize, slugify } from "@/lib/utils";
import { useFormAction } from "./use-form-action";

export interface CategoryRowData {
  id: string;
  name: string;
  slug: string;
  courseCount: number;
  batchCount: number;
}

export function CategoriesManager({ categories }: { categories: CategoryRowData[] }) {
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
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
        toast.success(res.message ?? "Category deleted successfully", res.data.unlinked ? `Unlinked from ${pluralize(res.data.unlinked, "course or batch", "courses and batches")}.` : undefined);
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
        <EmptyState icon={<Icon.Tag />} title="No Categories Found" description="Add one to get started. Categories group courses and batches in the catalog." />
      ) : (
        <>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="w-full sm:max-w-xs">
              <Input
                type="search"
                aria-label="Search categories"
                placeholder="Search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                leftAddon={<Icon.Search className="size-4" />}
              />
            </div>
            <p className="text-xs text-ink-muted">{pluralize(categories.length, "category", "categories")}</p>
          </div>
          <Table>
            <THead>
              <tr>
                <TH>Category</TH>
                <TH className="hidden sm:table-cell">Slug</TH>
                <TH className="hidden md:table-cell">Used by</TH>
                <TH className="w-24 text-right">
                  <span className="sr-only">Actions</span>
                </TH>
              </tr>
            </THead>
            <TBody>
              {filtered.length === 0 ? (
                <TableEmpty colSpan={4}>No categories match “{search}”.</TableEmpty>
              ) : (
                filtered.map((c) =>
                  editing === c.id ? (
                    <EditCategoryRow key={c.id} category={c} onDone={() => setEditing(null)} />
                  ) : (
                    <TR key={c.id}>
                      <TD>
                        <p className="font-medium">{c.name}</p>
                        <p className="font-mono text-xs text-ink-muted sm:hidden">/{c.slug}</p>
                      </TD>
                      <TD className="hidden font-mono text-xs text-ink-muted sm:table-cell">{c.slug}</TD>
                      <TD className="hidden text-ink-muted md:table-cell">
                        {c.courseCount + c.batchCount === 0 ? (
                          <span className="text-ink-faint">Not used yet</span>
                        ) : (
                          <>
                            {pluralize(c.courseCount, "course")} · {pluralize(c.batchCount, "batch", "batches")}
                          </>
                        )}
                      </TD>
                      <TD className="text-right">
                        <div className="flex justify-end gap-1">
                          <IconButton label={`Edit ${c.name}`} size="icon-sm" onClick={() => setEditing(c.id)}>
                            <Icon.Edit className="size-4" />
                          </IconButton>
                          <IconButton label={`Delete ${c.name}`} size="icon-sm" className="hover:text-danger" onClick={() => setToDelete(c)}>
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
        title="Delete this category?"
        description="This will unlink this category from all courses and batches using it, and then delete it. This cannot be undone."
        confirmLabel="Delete"
      />
    </div>
  );
}

function NewCategoryForm() {
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
      <p className="mb-3 text-sm font-semibold text-ink">New Category</p>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-start">
        <div>
          <label htmlFor="new-category-name" className="sr-only">
            Name
          </label>
          <Input
            id="new-category-name"
            name="name"
            placeholder="Category name"
            value={name}
            maxLength={60}
            onChange={(e) => {
              setName(e.target.value);
              if (!slugTouched) setSlug(slugify(e.target.value));
            }}
            invalid={!!errors.name}
            required
          />
          {errors.name && <p className="mt-1 text-xs text-danger">{errors.name}</p>}
        </div>
        <div>
          <label htmlFor="new-category-slug" className="sr-only">
            Slug
          </label>
          <Input
            id="new-category-slug"
            name="slug"
            placeholder="slug"
            value={slug}
            onChange={(e) => {
              setSlug(e.target.value);
              setSlugTouched(true);
            }}
            className="font-mono"
            leftAddon={<span className="text-xs">/</span>}
            invalid={!!errors.slug}
          />
          {errors.slug ? <p className="mt-1 text-xs text-danger">{errors.slug}</p> : <p className="mt-1 text-xs text-ink-muted">Used in catalog filter URLs.</p>}
        </div>
        <Button type="submit" loading={pending} leftIcon={<Icon.Plus className="size-4" />} disabled={!name.trim()}>
          Create
        </Button>
      </div>
    </form>
  );
}

function EditCategoryRow({ category, onDone }: { category: CategoryRowData; onDone: () => void }) {
  const { onSubmit, pending, errors, dirty, markDirty } = useFormAction(updateCategoryAction, { onSuccess: onDone });
  return (
    <tr className="bg-accent/5">
      <td colSpan={4} className="px-4 py-3">
        <form onSubmit={onSubmit} onChange={markDirty} noValidate className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-start">
          <input type="hidden" name="id" value={category.id} />
          <div>
            <label htmlFor={`name-${category.id}`} className="mb-1 block text-xs font-medium text-ink-muted">
              Name
            </label>
            <Input id={`name-${category.id}`} name="name" defaultValue={category.name} maxLength={60} invalid={!!errors.name} autoFocus />
            {errors.name && <p className="mt-1 text-xs text-danger">{errors.name}</p>}
          </div>
          <div>
            <label htmlFor={`slug-${category.id}`} className="mb-1 block text-xs font-medium text-ink-muted">
              Slug
            </label>
            <Input id={`slug-${category.id}`} name="slug" defaultValue={category.slug} className="font-mono" invalid={!!errors.slug} />
            {errors.slug && <p className="mt-1 text-xs text-danger">{errors.slug}</p>}
          </div>
          <div className="flex gap-2 sm:pt-5">
            <Button type="submit" size="sm" loading={pending} disabled={!dirty}>
              Save
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={onDone} disabled={pending}>
              Cancel
            </Button>
          </div>
        </form>
      </td>
    </tr>
  );
}
