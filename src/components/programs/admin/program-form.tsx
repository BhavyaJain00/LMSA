"use client";

import { useRef, useState } from "react";
import type { Program } from "@/lib/types";
import { createProgramAction, deleteProgramAction, updateProgramAction } from "@/lib/actions/programs";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardFooter, CardHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Checkbox, Field, FormError, Input, Textarea } from "@/components/ui/input";
import { Icon } from "@/components/ui/icons";
import { useActionForm, useServerAction } from "@/components/batches/hooks";

interface Values {
  title: string;
  slug: string;
  description: string;
  published: boolean;
  enforceCourseOrder: boolean;
}

/** Create or edit a program's details (title, URL, description, published, enforced order). */
export function ProgramDetailsForm({ program }: { program?: Program }) {
  const initial: Values = {
    title: program?.title ?? "",
    slug: program?.slug ?? "",
    description: program?.description ?? "",
    published: program?.published ?? false,
    enforceCourseOrder: program?.enforceCourseOrder ?? true,
  };
  const [values, setValues] = useState<Values>(initial);
  const [saved, setSaved] = useState<Values>(initial);
  const submitted = useRef<Values>(initial);
  const { submit, pending, error, fieldErrors } = useActionForm(program ? updateProgramAction : createProgramAction, {
    onSuccess: () => setSaved(submitted.current),
  });
  const set = <K extends keyof Values>(key: K, value: Values[K]) => setValues((v) => ({ ...v, [key]: value }));
  const dirty = JSON.stringify(values) !== JSON.stringify(saved);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submitted.current = values;
        submit(new FormData(e.currentTarget));
      }}
      noValidate
    >
      <Card>
        <CardHeader
          title={program ? "Edit Program" : "Create Program"}
          description={program ? undefined : "You can add courses and members after creating the program."}
          actions={
            program && dirty ? (
              <Badge tone="warning" dot>
                Not Saved
              </Badge>
            ) : undefined
          }
        />
        <CardBody className="space-y-4">
          {program && <input type="hidden" name="programId" value={program.id} />}
          <FormError message={error} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Title" htmlFor="program-title" required error={fieldErrors.title} className={program ? undefined : "sm:col-span-2"}>
              <Input id="program-title" name="title" value={values.title} onChange={(e) => set("title", e.target.value)} required maxLength={140} invalid={!!fieldErrors.title} placeholder="e.g. Full-Stack Developer Path" autoFocus={!program} />
            </Field>
            {program && (
              <Field label="URL" htmlFor="program-slug" error={fieldErrors.slug} hint={`/programs/${values.slug || "…"}`}>
                <Input id="program-slug" name="slug" value={values.slug} onChange={(e) => set("slug", e.target.value.toLowerCase())} invalid={!!fieldErrors.slug} />
              </Field>
            )}
          </div>
          <Field label="Description" htmlFor="program-description" error={fieldErrors.description}>
            <Textarea id="program-description" name="description" rows={3} maxLength={2000} value={values.description} onChange={(e) => set("description", e.target.value)} placeholder="What will learners achieve by completing this program?" />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Checkbox name="published" checked={values.published} onChange={(e) => set("published", e.target.checked)} label="Published" description="Visible on the programs page and open for enrollment." />
            <Checkbox
              name="enforceCourseOrder"
              checked={values.enforceCourseOrder}
              onChange={(e) => set("enforceCourseOrder", e.target.checked)}
              label="Enforce Course Order"
              description="Each course unlocks after the previous one is completed."
            />
          </div>
        </CardBody>
        <CardFooter>
          {!program && (
            <ButtonLink href="/admin/programs" variant="outline">
              Cancel
            </ButtonLink>
          )}
          {program && dirty && (
            <Button variant="ghost" onClick={() => setValues(saved)} disabled={pending}>
              Discard
            </Button>
          )}
          <Button type="submit" loading={pending} disabled={!!program && !dirty}>
            {program ? "Save" : "Create program"}
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}

export function DeleteProgramButton({ programId, title }: { programId: string; title: string }) {
  const [open, setOpen] = useState(false);
  const { pending, run } = useServerAction();
  return (
    <>
      <Button variant="outline" className="text-danger" onClick={() => setOpen(true)} leftIcon={<Icon.Trash className="size-4" />}>
        Delete program
      </Button>
      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        onConfirm={() => run(() => deleteProgramAction(programId))}
        loading={pending}
        destructive
        title="Delete Program"
        description={`Are you sure you want to delete "${title}"? This action cannot be undone. Members keep their course enrollments and progress.`}
        confirmLabel="Delete"
      />
    </>
  );
}
