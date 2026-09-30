/**
 * Storage driver contract shared by the local folder driver and the
 * S3-compatible driver.
 *
 * Keys are "/"-separated paths relative to the storage root, using the same
 * layout as the upload folder: `videos/intro-abc.mp4`, `logo-xyz.png`,
 * `videos/<lessonId>/<blockId>/hls/<version>/720p/seg_00001.m4s`. Every file
 * keeps the public URL `/uploads/<key>`, whichever driver holds its bytes.
 */

export type StorageDriverKind = "local" | "s3";

export interface StoredObjectInfo {
  size: number;
  contentType?: string;
  lastModified?: Date;
  etag?: string;
}

export interface PutOptions {
  contentType: string;
  cacheControl?: string;
  /** Local driver: move the source file instead of copying it. Remote drivers delete the source after a successful upload. */
  move?: boolean;
  /** Bytes stored so far (large uploads report after each part). */
  onProgress?: (bytes: number) => void;
  signal?: AbortSignal;
}

export interface ReadResult {
  body: ReadableStream<Uint8Array>;
  /** HTTP status to relay: 200, or 206 for a satisfied range. */
  status: 200 | 206;
  /** Bytes in this response. */
  length: number;
  /** Total object size. */
  size: number;
  contentRange?: string;
  contentType?: string;
  lastModified?: Date;
  etag?: string;
}

/** Where ffmpeg reads a stored file from: a local path or a short-lived URL. */
export interface ProcessingInput {
  input: string;
  /** "file" inputs are local paths; "url" inputs are presigned HTTPS URLs. */
  type: "file" | "url";
}

export interface StorageDriver {
  readonly kind: StorageDriverKind;
  /** Store a local file under `key` (streamed; large files go up part by part). */
  putFile(key: string, filePath: string, opts: PutOptions): Promise<void>;
  /** Store a small in-memory body. */
  putBytes(key: string, bytes: Uint8Array, opts: Omit<PutOptions, "move" | "onProgress">): Promise<void>;
  head(key: string): Promise<StoredObjectInfo | null>;
  /** Read an object, optionally a single `bytes=a-b` range. Null when missing; "unsatisfiable" for a bad range. */
  read(key: string, range?: string | null): Promise<ReadResult | "unsatisfiable" | null>;
  /** Read a small text object (playlists), null when missing or larger than `maxBytes`. */
  readText(key: string, maxBytes: number): Promise<string | null>;
  delete(key: string): Promise<void>;
  /** Delete every object whose key starts with `prefix` (which must end with "/"). Returns how many were removed (local: 1 per folder). */
  deletePrefix(prefix: string): Promise<number>;
  /** Input for ffmpeg/ffprobe. */
  processingInput(key: string, ttlSeconds: number): Promise<ProcessingInput>;
}
