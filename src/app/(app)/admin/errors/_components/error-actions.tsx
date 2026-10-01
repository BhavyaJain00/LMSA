"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteErrorsAction, deleteResolvedErrorsAction, setErrorsResolvedAction } from "@/lib/errors/actions";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";

/** Resolve / reopen and delete buttons on an error group's detail page. */
export function ErrorDetailActions({ id, resolved }: { id: string; resolved: boolean }) {
  const router = useRouter();
  const { toast } = useToast();
  const [confirm, setConfirm] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <>
      <Button
        variant={resolved ? "outline" : "primary"}
        leftIcon={resolved ? <Icon.Refresh className="size-4" /> : <Icon.CheckCircle className="size-4" />}
        loading={pending && !confirm}
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const res = await setErrorsResolvedAction([id], !resolved);
            if (res.ok) {
              toast({ title: res.message ?? (resolved ? "Reopened" : "Resolved"), tone: "success" });
              router.refresh();
            } else toast({ title: res.error, tone: "error" });
          })
        }
      >
        {resolved ? "Reopen" : "Mark resolved"}
      </Button>
      <Button variant="outline" className="text-danger hover:bg-danger/10" leftIcon={<Icon.Trash className="size-4" />} disabled={pending} onClick={() => setConfirm(true)}>
        Delete
      </Button>
      <ConfirmDialog
        open={confirm}
        onClose={() => (pending ? undefined : setConfirm(false))}
        title="Delete this error?"
        description="The group and its stack trace are removed. If the problem happens again it is logged as a new error."
        confirmLabel="Delete"
        destructive
        loading={pending}
        onConfirm={() =>
          startTransition(async () => {
            const res = await deleteErrorsAction([id]);
            if (res.ok) {
              toast({ title: res.message ?? "Deleted", tone: "success" });
              router.push("/admin/errors");
            } else {
              toast({ title: res.error, tone: "error" });
              setConfirm(false);
            }
          })
        }
      />
    </>
  );
}

/** Header button that clears every resolved group. */
export function DeleteResolvedButton({ count }: { count: number }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  return (
    <>
      <Button variant="outline" leftIcon={<Icon.Trash className="size-4" />} onClick={() => setOpen(true)}>
        Delete resolved
      </Button>
      <ConfirmDialog
        open={open}
        onClose={() => (pending ? undefined : setOpen(false))}
        title={`Delete ${count} resolved ${count === 1 ? "error" : "errors"}?`}
        description="Resolved groups and their stack traces are removed. Open errors are kept."
        confirmLabel="Delete resolved"
        destructive
        loading={pending}
        onConfirm={() =>
          startTransition(async () => {
            const res = await deleteResolvedErrorsAction();
            toast(res.ok ? { title: res.message ?? "Deleted", tone: "success" } : { title: res.error, tone: "error" });
            setOpen(false);
          })
        }
      />
    </>
  );
}
