"use client";

import { enrollInProgramAction, startProgramCourseAction } from "@/lib/actions/programs";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/input";
import { Icon } from "@/components/ui/icons";
import { useActionForm } from "@/components/batches/hooks";

/** "Enroll in program" – creates the membership and enrolls in the first (or every) course. */
export function EnrollProgramButton({ programId, className }: { programId: string; className?: string }) {
  const { onSubmit, pending, error } = useActionForm(enrollInProgramAction);
  return (
    <form onSubmit={onSubmit} className={className}>
      <input type="hidden" name="programId" value={programId} />
      <FormError message={error} />
      <Button type="submit" size="lg" loading={pending} className="mt-2 w-full sm:w-auto" leftIcon={<Icon.GraduationCap className="size-5" />}>
        Enroll in program
      </Button>
    </form>
  );
}

/** Start an unlocked course of the program (enrolls and opens the first lesson). */
export function StartProgramCourseButton({ programId, courseId }: { programId: string; courseId: string }) {
  const { onSubmit, pending, error } = useActionForm(startProgramCourseAction);
  return (
    <form onSubmit={onSubmit} className="space-y-2">
      <input type="hidden" name="programId" value={programId} />
      <input type="hidden" name="courseId" value={courseId} />
      <FormError message={error} />
      <Button type="submit" size="sm" loading={pending} className="w-full" rightIcon={<Icon.ArrowRight className="size-4" />}>
        Start course
      </Button>
    </form>
  );
}
