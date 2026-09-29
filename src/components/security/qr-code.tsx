import { qrToPath, tryEncodeQr, type QrCode as QrMatrix, type QrErrorCorrection } from "@/lib/qr";
import { cn } from "@/lib/utils";

/**
 * Renders text as a QR code with the hand-written encoder in `src/lib/qr`
 * (byte mode, ECC level M by default, versions 1–40). Works in Server and
 * Client Components. Always dark-on-white with a 4-module quiet zone so
 * scanners read it in dark mode too.
 *
 * Pass `code` when the matrix was already encoded (the caller checked it
 * fits). If `value` can't be encoded, a short explanation is shown instead of
 * throwing, so the page around it keeps working.
 */
export function QrCode({
  value,
  code,
  title,
  errorCorrection = "M",
  className,
  unavailableText = "QR code unavailable — use the setup key instead.",
}: {
  value?: string;
  code?: QrMatrix | null;
  title: string;
  errorCorrection?: QrErrorCorrection;
  className?: string;
  unavailableText?: string;
}) {
  const qr = code ?? (value !== undefined ? tryEncodeQr(value, { errorCorrection }) : null);
  if (!qr) {
    return (
      <div
        role="img"
        aria-label={title}
        className={cn("flex aspect-square w-full items-center justify-center rounded-lg bg-white p-3 text-center text-xs text-neutral-600", className)}
      >
        {unavailableText}
      </div>
    );
  }
  const margin = 4;
  const dim = qr.size + margin * 2;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${dim} ${dim}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label={title}
      className={cn("block h-auto w-full rounded-lg bg-white", className)}
    >
      <title>{title}</title>
      <rect width={dim} height={dim} fill="#ffffff" />
      <path d={qrToPath(qr, margin)} fill="#000000" />
    </svg>
  );
}
