import type { ComponentProps } from "react";
import { PublicI18n } from "@/components/catalog/public-i18n";
import { ProgramCoursesManager as ProgramCoursesManagerClient, ProgramMembersManager as ProgramMembersManagerClient } from "./program-managers-client";

/** Messages the program managers need (they render on admin pages, outside the public group's layouts). */
const PICK = ["programsAdmin."] as const;

/** Ordered courses of a program; see `./program-managers-client.tsx`. */
export function ProgramCoursesManager(props: ComponentProps<typeof ProgramCoursesManagerClient>) {
  return (
    <PublicI18n pick={PICK}>
      <ProgramCoursesManagerClient {...props} />
    </PublicI18n>
  );
}

/** Program members with progress; see `./program-managers-client.tsx`. */
export function ProgramMembersManager(props: ComponentProps<typeof ProgramMembersManagerClient>) {
  return (
    <PublicI18n pick={PICK}>
      <ProgramMembersManagerClient {...props} />
    </PublicI18n>
  );
}
