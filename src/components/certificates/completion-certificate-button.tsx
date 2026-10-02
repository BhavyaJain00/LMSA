"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { claimCompletionCertificateAction } from "@/lib/actions/certificates";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import { useT } from "@/i18n/client";

/**
 * "Get Certificate" for completion-certificate courses: issues (or fetches)
 * the learner's certificate and opens its page.
 */
export function CompletionCertificateButton({ courseId, label, variant = "primary", size = "md", className }: {
  courseId: string;
  label?: string;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  className?: string;
}) {
  const t = useT("public");
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant={variant}
      size={size}
      className={className}
      loading={pending}
      leftIcon={<Icon.GraduationCap className="size-4" />}
      onClick={() =>
        startTransition(async () => {
          const res = await claimCompletionCertificateAction(courseId);
          if (!res.ok) {
            toast({ title: res.error, tone: "error" });
            return;
          }
          if (res.message) toast({ title: res.message, tone: "success" });
          router.push(res.data.href);
        })
      }
    >
      {label ?? t("enroll.getCertificate")}
    </Button>
  );
}
