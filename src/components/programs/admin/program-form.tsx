import type { ComponentProps } from "react";
import { PublicI18n } from "@/components/catalog/public-i18n";
import { DeleteProgramButton as DeleteProgramButtonClient, ProgramDetailsForm as ProgramDetailsFormClient } from "./program-form-client";

/** Messages the program admin forms need (they render on admin pages, outside the public group's layouts). */
const PICK = ["programsAdmin."] as const;

/** Create or edit a program's details; see `./program-form-client.tsx`. */
export function ProgramDetailsForm(props: ComponentProps<typeof ProgramDetailsFormClient>) {
  return (
    <PublicI18n pick={PICK}>
      <ProgramDetailsFormClient {...props} />
    </PublicI18n>
  );
}

export function DeleteProgramButton(props: ComponentProps<typeof DeleteProgramButtonClient>) {
  return (
    <PublicI18n pick={PICK}>
      <DeleteProgramButtonClient {...props} />
    </PublicI18n>
  );
}
