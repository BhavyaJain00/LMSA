"use client";

import { useState } from "react";
import { createAnnouncementAction, deleteAnnouncementAction } from "@/lib/actions/announcements";
import { Button, IconButton } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Tooltip } from "@/components/ui/dropdown";
import { Field, FormError, Input } from "@/components/ui/input";
import { Icon } from "@/components/ui/icons";
import { EmptyState } from "@/components/ui/skeleton";
import { AnnouncementList } from "../announcement-list";
import { useActionForm, useServerAction } from "../hooks";
import type { AnnouncementView } from "../types";
import { MarkdownField } from "./form-fields";

function Composer({ batchId, studentCount }: { batchId: string; studentCount: number }) {
  const [body, setBody] = useState("");
  const [formKey, setFormKey] = useState(0);
  const { onSubmit, pending, error, fieldErrors } = useActionForm(createAnnouncementAction, {
    onSuccess: () => {
      setBody("");
      setFormKey((k) => k + 1);
    },
  });
  const disabled = studentCount === 0;

  return (
    <Card>
      <CardHeader title="Make an Announcement" description={disabled ? "Enroll students in this batch before posting an announcement" : `Every enrolled student (${studentCount}) gets an in-app notification.`} />
      <CardBody>
        <form key={formKey} onSubmit={onSubmit} className="space-y-4" noValidate>
          <input type="hidden" name="batchId" value={batchId} />
          <FormError message={error} />
          <Field label="Subject" htmlFor="ann-subject" required error={fieldErrors.subject}>
            <Input id="ann-subject" name="subject" required maxLength={160} invalid={!!fieldErrors.subject} disabled={disabled} placeholder="e.g. Slides from Tuesday's class are up" />
          </Field>
          <Field label="Announcement" htmlFor="ann-body" required error={fieldErrors.body}>
            <MarkdownField id="ann-body" name="body" value={body} onChange={setBody} rows={7} invalid={!!fieldErrors.body} placeholder="Write your update. Markdown is supported." />
          </Field>
          <Field label="CC" htmlFor="ann-cc" error={fieldErrors.cc} hint="Optional. Comma separated email addresses kept with the announcement (e.g. mentors).">
            <Input id="ann-cc" name="cc" invalid={!!fieldErrors.cc} disabled={disabled} placeholder="mentor@example.com, ta@example.com" />
          </Field>
          <div className="flex justify-end">
            {disabled ? (
              <Tooltip label="Enroll students in this batch before posting an announcement">
                <Button disabled leftIcon={<Icon.Send className="size-4" />}>
                  Send announcement
                </Button>
              </Tooltip>
            ) : (
              <Button type="submit" loading={pending} leftIcon={<Icon.Send className="size-4" />}>
                Send to {studentCount} student{studentCount === 1 ? "" : "s"}
              </Button>
            )}
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

export function AnnouncementsPanel({ batchId, announcements, studentCount }: { batchId: string; announcements: AnnouncementView[]; studentCount: number }) {
  const [deleting, setDeleting] = useState<AnnouncementView | null>(null);
  const { pending, run } = useServerAction();
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Composer batchId={batchId} studentCount={studentCount} />
      <section className="space-y-4">
        <h2 className="text-base font-semibold text-ink">Sent announcements ({announcements.length})</h2>
        {announcements.length === 0 ? (
          <EmptyState icon={<Icon.Megaphone />} title="Nothing has been announced in this batch yet" description="Announcements you send appear here and on the batch page." compact />
        ) : (
          <AnnouncementList
            announcements={announcements}
            showCc
            actions={(a) => (
              <IconButton label={`Delete announcement ${a.subject}`} size="icon-sm" onClick={() => setDeleting(a)} className="hover:text-danger">
                <Icon.Trash className="size-4" />
              </IconButton>
            )}
          />
        )}
      </section>
      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting) run(() => deleteAnnouncementAction(deleting.id), { onSuccess: () => setDeleting(null) });
        }}
        loading={pending}
        destructive
        title="Delete this announcement?"
        description="It will be removed from the batch page. Notifications already delivered stay in learners' inboxes."
        confirmLabel="Delete"
      />
    </div>
  );
}
