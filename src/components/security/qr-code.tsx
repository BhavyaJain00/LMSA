import { encodeQr, qrToPath, type QrErrorCorrection } from "@/lib/qr";
import { cn } from "@/lib/utils";

/**
 * Renders text as a QR code with the hand-written encoder in `src/lib/qr`
 * (byte mode, ECC level M by default). Works in Server and Client Components.
 * Always dark-on-white with a 4-module quiet zone so scanners read it in dark
 * mode too.
 */
export function QrCode({ value, title, errorCorrection = "M", className }: { value: string; title: string; errorCorrection?: QrErrorCorrection; className?: string }) {
  const qr = encodeQr(value, { errorCorrection });
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
