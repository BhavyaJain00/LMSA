import { ImageResponse } from "next/og";

/**
 * iOS home-screen icon (apple-touch-icon). iOS ignores SVG touch icons, so the
 * graduation-cap mark from `app/icon.svg` is rendered to a 180×180 PNG at
 * build time. The square is opaque and edge to edge: iOS rounds the corners.
 */
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#4f46e5",
        }}
      >
        <svg width="124" height="124" viewBox="6 5 52 52" xmlns="http://www.w3.org/2000/svg">
          <path d="M32 16 12 26l20 10 20-10-20-10Z" fill="#ffffff" />
          <path d="M20 31.5V40c0 3.3 5.4 6 12 6s12-2.7 12-6v-8.5l-12 6-12-6Z" fill="#ffffff" opacity="0.9" />
          <path d="M50 26v12" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" />
        </svg>
      </div>
    ),
    { ...size },
  );
}
