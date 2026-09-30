import { type BroadcastPhase, PHASE_LABELS } from "@/lib/comms/broadcast-core";
import { Badge, type BadgeTone } from "@/components/ui/badge";

const PHASE_TONES: Record<BroadcastPhase, BadgeTone> = {
  draft: "neutral",
  scheduled: "info",
  sending: "accent",
  paused: "warning",
  sent: "success",
  stopped: "danger",
};

export function BroadcastPhaseBadge({ phase, size }: { phase: BroadcastPhase; size?: "xs" | "sm" | "md" }) {
  return (
    <Badge tone={PHASE_TONES[phase]} size={size} dot>
      {PHASE_LABELS[phase]}
    </Badge>
  );
}
