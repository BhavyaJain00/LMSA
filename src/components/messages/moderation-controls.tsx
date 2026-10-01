"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState, useTransition } from "react";
import type { ActionResult } from "@/lib/types";
import { resolveReportAction, saveMessagingSettingsAction } from "@/lib/actions/messages";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { FormError, Switch } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";

/** Resolve an open report from the moderation list. */
export function ResolveReportButton({ conversationId }: { conversationId: string }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  return (
    <Button
      size="xs"
      variant="outline"
      loading={pending}
      leftIcon={<Icon.CheckCircle className="size-3.5" />}
      onClick={() =>
        start(async () => {
          const result = await resolveReportAction(conversationId);
          if (result.ok) {
            toast.success(result.message ?? "Report resolved");
            router.refresh();
          } else toast.error(result.error);
        })
      }
    >
      Resolve
    </Button>
  );
}

/** Settings → messaging switches. Moderators see them; administrators change them. */
export function MessagingSettingsForm({ enabled, studentToStudent, canEdit }: { enabled: boolean; studentToStudent: boolean; canEdit: boolean }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(saveMessagingSettingsAction, null);
  const [on, setOn] = useState(enabled);
  const [peers, setPeers] = useState(studentToStudent);
  const { toast } = useToast();
  const dirty = on !== enabled || peers !== studentToStudent;

  useEffect(() => {
    if (state?.ok) toast({ title: state.message ?? "Saved", tone: "success" });
  }, [state, toast]);

  return (
    <form action={action} className="space-y-4">
      <Switch
        name="enabled"
        checked={on}
        disabled={!canEdit || pending}
        onChange={(e) => setOn(e.target.checked)}
        label="Direct messages"
        description="Members get a Messages inbox. Learners can write to the instructors of courses and batches they're enrolled in; instructors and moderators can write to any member."
      />
      <Switch
        name="studentToStudent"
        checked={peers}
        disabled={!canEdit || pending}
        onChange={(e) => setPeers(e.target.checked)}
        label="Learners can message classmates"
        description="Lets learners start conversations with other learners who share a course or batch with them."
      />
      {state && !state.ok && <FormError message={state.error} />}
      {canEdit ? (
        <div className="flex items-center justify-end gap-2">
          {dirty && <span className="text-xs text-ink-muted">Unsaved changes</span>}
          <Button type="submit" size="sm" loading={pending} disabled={!dirty}>
            Save messaging settings
          </Button>
        </div>
      ) : (
        <p className="text-xs text-ink-muted">Only administrators can change these settings.</p>
      )}
    </form>
  );
}
