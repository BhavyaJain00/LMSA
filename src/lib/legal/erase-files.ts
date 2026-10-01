import "server-only";
import { exportDatabase } from "@/lib/db/store";
import { siteOrigins } from "@/lib/media/access";
import { storageFor, storageKeyFromUrl, uploadUrlForKey } from "@/lib/storage";

/**
 * Delete the uploaded files of an erased account (see `personalUploadUrls`).
 * Runs after the erasure has been saved. A file is kept when the database
 * still mentions it anywhere (for example an administrator reused the
 * picture as a course image), and only files on this site's upload storage
 * (local disk or the S3 bucket) are touched. Never throws; returns how many
 * files were deleted.
 */
export async function deleteErasedUploads(urls: readonly string[]): Promise<number> {
  const origins = siteOrigins();
  const keys = [...new Set(urls.map((u) => storageKeyFromUrl(u, origins)).filter((k): k is string => !!k))];
  if (!keys.length) return 0;
  let deleted = 0;
  try {
    const remaining = await exportDatabase();
    for (const key of keys) {
      if (remaining.includes(uploadUrlForKey(key)) || remaining.includes(key)) continue;
      try {
        await (await storageFor(key)).delete(key);
        deleted++;
      } catch (error) {
        console.error(`[privacy] could not delete the erased account's file ${key}:`, error instanceof Error ? error.message : String(error));
      }
    }
  } catch (error) {
    console.error("[privacy] could not clean up the erased account's files:", error instanceof Error ? error.message : String(error));
  }
  return deleted;
}
