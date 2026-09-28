"use client";

import { useActionState, useState, useTransition } from "react";
import type { ActionResult } from "@/lib/types";
import { createCourseAnnouncementAction, deleteCourseAnnouncementAction } from "@/lib/actions/course-announcements";
import { Button, IconButton } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Field, FormError, Input } from "@/components/ui/input";
import { Icon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import { MarkdownEditor } from "./markdown-editor";
import { UnsavedChangesGuard } from "./unsaved-changes-guard";

/** Compose form. Remounted (via `key`) after each successful send to clear it. */
export function AnnouncementComposer({ courseId, recipientCount, onSent }: { courseId: string; recipientCount: number; onSent?: () => void }) {
  const toast = useToast();
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [cc, setCc] = useState("");
  const [showCc, setShowCc] = useState(false);
  const [state, formAction, pending] = useActionState(async (prev: ActionResult<{ recipients: number }> | null, formData: FormData) => {
    const result = await createCourseAnnouncementAction(null, formData);
    if (!result) return prev;
    if (result.ok) {
      toast.success(result.message ?? "Announcement posted");
      setSubject("");
      setBody("");
      setCc("");
      onSent?.();
    }
    return result;
  }, null);
  const errors = state && !state.ok ? (state.fieldErrors ?? {}) : {};
  const dirty = !!(subject.trim() || body.trim());

  return (
    <Card>
      <CardHeader
        title="New announcement"
        description={
          recipientCount > 0
            ? `Everyone enrolled (${recipientCount} ${recipientCount === 1 ? "learner" : "learners"}) gets an in-app notification.`
            : "No one is enrolled yet. The announcement will still appear on the course for future learners."
        }
      />
      <CardBody>
        <form action={formAction} className="space-y-4" noValidate>
          <UnsavedChangesGuard dirty={dirty && !pending} message="Your announcement hasn't been sent yet. Leave anyway?" />
          <input type="hidden" name="courseId" value={courseId} />
          <FormError message={state && !state.ok && !Object.keys(errors).length ? state.error : null} />
          <Field label="Subject" htmlFor="ann-subject" required error={errors.subject}>
            <Input id="ann-subject" name="subject" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={150} placeholder="e.g. New chapter available" invalid={!!errors.subject} />
          </Field>
          <Field htmlFor="ann-body" label="Message" required error={errors.body}>
            <MarkdownEditor id="ann-body" name="body" value={body} onChange={setBody} rows={7} invalid={!!errors.body} placeholder="Write your announcement. Markdown is supported." />
          </Field>
          {showCc ? (
            <Field label="CC" htmlFor="ann-cc" error={errors.cc} hint="Comma-separated emails. Members with these emails are notified too.">
              <Input id="ann-cc" name="cc" value={cc} onChange={(e) => setCc(e.target.value)} placeholder="mentor@example.com, ta@example.com" invalid={!!errors.cc} />
            </Field>
          ) : (
            <button type="button" onClick={() => setShowCc(true)} className="text-sm font-medium text-accent hover:underline">
              + Add CC
            </button>
          )}
          <div className="flex justify-end">
            <Button type="submit" loading={pending} leftIcon={<Icon.Send className="size-4" />}>
              Send announcement
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

export function DeleteAnnouncementButton({ id, subject }: { id: string; subject: string }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  return (
    <>
      <IconButton label={`Delete announcement “${subject}”`} size="icon-sm" onClick={() => setOpen(true)} className="text-ink-faint hover:text-danger">
        <Icon.Trash className="size-4" />
      </IconButton>
      <ConfirmDialog
        open={open}
        onClose={() => !pending && setOpen(false)}
        loading={pending}
        onConfirm={() =>
          startTransition(async () => {
            const res = await deleteCourseAnnouncementAction(id);
            if (res.ok) {
              toast.success(res.message ?? "Announcement deleted");
              setOpen(false);
            } else toast.error(res.error);
          })
        }
        title="Delete this announcement?"
        description="It will be removed from the course. Notifications already delivered stay in learners' inboxes."
        confirmLabel="Delete"
        destructive
      />
    </>
  );
}
