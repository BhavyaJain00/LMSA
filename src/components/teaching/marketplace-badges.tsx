import type { Earning, InstructorProfile } from "@/lib/types";
import { APPLICATION_STATUS_LABELS } from "@/lib/teaching/marketplace-shared";
import { Badge, type BadgeTone } from "@/components/ui/badge";

/** Status badges of the instructor marketplace (server and client safe). */

const APPLICATION_TONES: Record<InstructorProfile["status"], BadgeTone> = { applied: "warning", approved: "success", rejected: "neutral" };

export function ApplicationStatusBadge({ status }: { status: InstructorProfile["status"] }) {
  return (
    <Badge tone={APPLICATION_TONES[status]} dot>
      {APPLICATION_STATUS_LABELS[status]}
    </Badge>
  );
}

const EARNING_TONES: Record<Earning["status"], BadgeTone> = { pending: "warning", paid: "success", void: "neutral" };
const EARNING_LABELS: Record<Earning["status"], string> = { pending: "Unpaid", paid: "Paid", void: "Void" };

export function EarningStatusBadge({ status }: { status: Earning["status"] }) {
  return (
    <Badge tone={EARNING_TONES[status]} dot>
      {EARNING_LABELS[status]}
    </Badge>
  );
}
