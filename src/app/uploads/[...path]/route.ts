import { NextResponse, type NextRequest } from "next/server";
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { siteConfig } from "@/lib/config";

const MIME: Record<string, string> = {
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".ogv": "video/ogg",
  ".mov": "video/quicktime",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".avif": "image/avif",
  ".pdf": "application/pdf",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".vtt": "text/vtt; charset=utf-8",
  ".zip": "application/zip",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".weba": "audio/webm",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

/**
 * Serves uploaded files from storage/uploads with HTTP Range support so the
 * custom video player can seek inside self-hosted videos.
 */
export async function GET(req: NextRequest, ctx: RouteContext<"/uploads/[...path]">) {
  const { path: parts } = await ctx.params;
  const name = parts.join("/");
  if (name.includes("..") || name.startsWith("/")) return new NextResponse("Not found", { status: 404 });

  const root = path.join(process.cwd(), siteConfig.uploadDir);
  const filePath = path.join(root, name);
  if (!filePath.startsWith(root)) return new NextResponse("Not found", { status: 404 });

  let stat;
  try {
    stat = await fs.stat(filePath);
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
  if (!stat.isFile()) return new NextResponse("Not found", { status: 404 });

  const ext = path.extname(filePath).toLowerCase();
  const type = MIME[ext] ?? "application/octet-stream";
  const size = stat.size;
  const range = req.headers.get("range");
  const baseHeaders: Record<string, string> = {
    "Content-Type": type,
    "Accept-Ranges": "bytes",
    "Cache-Control": "public, max-age=31536000, immutable",
    "Last-Modified": stat.mtime.toUTCString(),
  };

  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (m) {
      let start = m[1] ? Number(m[1]) : 0;
      let end = m[2] ? Number(m[2]) : size - 1;
      if (!m[1] && m[2]) {
        start = Math.max(0, size - Number(m[2]));
        end = size - 1;
      }
      if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= size) {
        return new NextResponse(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
      }
      end = Math.min(end, size - 1);
      const stream = Readable.toWeb(createReadStream(filePath, { start, end })) as ReadableStream;
      return new NextResponse(stream, {
        status: 206,
        headers: { ...baseHeaders, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) },
      });
    }
  }

  const stream = Readable.toWeb(createReadStream(filePath)) as ReadableStream;
  return new NextResponse(stream, { status: 200, headers: { ...baseHeaders, "Content-Length": String(size) } });
}
