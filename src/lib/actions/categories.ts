"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult, Category } from "@/lib/types";
import { getCurrentUser, isAdmin } from "@/lib/auth/session";
import { getDb, mutate } from "@/lib/db/store";
import { fd, slugify, uid } from "@/lib/utils";

async function requireAdmin() {
  const user = await getCurrentUser();
  return user && isAdmin(user) ? user : null;
}

function revalidateCategories() {
  revalidatePath("/admin/settings/categories");
  revalidatePath("/", "layout");
}

function validate(name: string, slug: string, id: string | null, categories: Category[]): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!name) errors.name = "Category name is required";
  else if (name.length > 60) errors.name = "Keep the name under 60 characters.";
  else if (categories.some((c) => c.id !== id && c.name.toLowerCase() === name.toLowerCase())) errors.name = "A category with this name already exists.";
  if (!slug) errors.slug = "Slug is required";
  else if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) errors.slug = "Use lowercase letters, numbers and dashes.";
  else if (categories.some((c) => c.id !== id && c.slug === slug)) errors.slug = "This slug is already used by another category.";
  return errors;
}

/** Create a category (Frappe: LMS Category). Slug defaults to the slugified name. */
export async function createCategoryAction(_prev: ActionResult<Category> | null, formData: FormData): Promise<ActionResult<Category>> {
  if (!(await requireAdmin())) return { ok: false, error: "Only administrators can manage categories." };
  const db = await getDb();
  const name = fd(formData, "name");
  const slug = fd(formData, "slug") ? slugify(fd(formData, "slug")) : name ? slugify(name) : "";
  const errors = validate(name, slug, null, db.categories);
  if (Object.keys(errors).length) return { ok: false, error: "Unable to add category", fieldErrors: errors };
  const category: Category = { id: uid("cat"), name, slug };
  await mutate((d) => {
    d.categories.push(category);
  });
  revalidateCategories();
  return { ok: true, data: category, message: "Category added successfully" };
}

export async function updateCategoryAction(_prev: ActionResult<Category> | null, formData: FormData): Promise<ActionResult<Category>> {
  if (!(await requireAdmin())) return { ok: false, error: "Only administrators can manage categories." };
  const db = await getDb();
  const id = fd(formData, "id");
  const current = db.categories.find((c) => c.id === id);
  if (!current) return { ok: false, error: "This category no longer exists." };
  const name = fd(formData, "name");
  const slug = slugify(fd(formData, "slug") || name);
  const errors = validate(name, slug, id, db.categories);
  if (Object.keys(errors).length) return { ok: false, error: "Unable to update category", fieldErrors: errors };
  const updated = await mutate((d) => {
    const row = d.categories.find((c) => c.id === id);
    if (!row) return null;
    row.name = name;
    row.slug = slug;
    return { ...row };
  });
  if (!updated) return { ok: false, error: "This category no longer exists." };
  revalidateCategories();
  return { ok: true, data: updated, message: "Category updated successfully" };
}

/** Unlink the category from every course and batch, then delete it. */
export async function deleteCategoryAction(id: string): Promise<ActionResult<{ unlinked: number }>> {
  if (!(await requireAdmin())) return { ok: false, error: "Only administrators can manage categories." };
  const result = await mutate((d) => {
    if (!d.categories.some((c) => c.id === id)) return null;
    let unlinked = 0;
    for (const course of d.courses) {
      if (course.categoryId === id) {
        course.categoryId = undefined;
        unlinked++;
      }
    }
    for (const batch of d.batches) {
      if (batch.categoryId === id) {
        batch.categoryId = undefined;
        unlinked++;
      }
    }
    d.categories = d.categories.filter((c) => c.id !== id);
    return { unlinked };
  });
  if (!result) return { ok: false, error: "Unable to delete category" };
  revalidateCategories();
  return { ok: true, data: result, message: "Category deleted successfully" };
}
