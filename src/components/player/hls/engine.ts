import {
  PlaylistParseError,
  isMasterPlaylist,
  mp4MimeType,
  parseMasterPlaylist,
  parseMediaPlaylist,
  splitCodecs,
  variantLabel,
  type ByteRange,
  type HlsMediaRendition,
  type HlsVariant,
  type InitSegment,
  type MediaPlaylist,
} from "./playlist";
import { BandwidthEstimator, chooseLevel, shouldAbandonDownload } from "./abr";
import { backBufferLength, bufferInfo, detachedForwardRanges, evictionRange, forwardFlushStart, retryDelayMs, segmentToLoad, toRanges, type TimeRange } from "./buffer";
import { HttpError, TimeoutError, abortError, isAbortError, loadBytes, loadText, sleep, waitOnline } from "./loader";
import { mediaSourceCtor } from "./support";

/**
 * Hand-written HLS engine on Media Source Extensions (no hls.js).
 *
 * Plays fMP4/CMAF HLS (what the transcoder produces): parses the master and
 * media playlists, creates SourceBuffers from the rendition CODECS, appends
 * the init segment and then media segments, keeps ~30 s buffered ahead and
 * evicts what lies more than ~60 s behind the playhead. Seeking looks the
 * target segment up, aborts the current download and re-appends from there.
 * Adaptive bitrate: EWMA throughput + buffer level choose the rendition at
 * each segment boundary (with hysteresis); a new rendition starts with its
 * own init segment. Network errors are retried with backoff; a 401/403
 * re-signs the master playlist through `refreshMasterUrl` and continues.
 * Anything unrecoverable is reported through `onFatal`, and the player falls
 * back to the progressive MP4.
 */

export interface HlsLevel {
  /** Index in `levels` (sorted by bandwidth, lowest first). */
  index: number;
  label: string;
  width?: number;
  height?: number;
  /** Peak bits per second. */
  bandwidth: number;
  codecs: string;
}

export interface HlsStats {
  /** Level being downloaded. */
  loadingLevel: number;
  /** Level of the picture at the playhead. */
  playingLevel: number;
  auto: boolean;
  levels: HlsLevel[];
  /** Estimated throughput, bits/s. */
  estimate: number;
  bufferAhead: number;
  backBuffer: number;
  forwardTarget: number;
  segmentsLoaded: number;
  bytesLoaded: number;
  lastSegment: { bytes: number; ms: number; level: number } | null;
  switches: number;
  retries: number;
  separateAudio: boolean;
}

export type HlsFatalReason = "unsupported" | "network" | "auth" | "media" | "parse";

export class HlsFatalError extends Error {
  constructor(
    readonly reason: HlsFatalReason,
    message: string,
  ) {
    super(message);
    this.name = "HlsFatalError";
  }
}

export interface HlsEngineOptions {
  video: HTMLVideoElement;
  /** Master (or single media) playlist URL; relative URLs resolve against the page. */
  masterUrl: string;
  /** Re-sign the master playlist URL after a 401/403. Resolves to null when access is gone. */
  refreshMasterUrl?: () => Promise<string | null>;
  /** Position (seconds) to start downloading from (resume). */
  startPosition?: number;
  /** Bits/s assumed before the first segment was measured. */
  initialBandwidth: number;
  /** Level to pin from the start (-1 = automatic), given the playable levels. */
  startLevel?: (levels: HlsLevel[]) => number;
  /** Rendered player height in device pixels (caps the automatic choice). */
  capHeight?: () => number | undefined;
  saveData?: boolean;
  /** Seconds to keep buffered ahead (default 30). */
  forwardBuffer?: number;
  /** Seconds to keep behind the playhead (default 60). */
  backBuffer?: number;
  onLevels?: (levels: HlsLevel[]) => void;
  onLevelChange?: (playingLevel: number) => void;
  onFatal?: (error: HlsFatalError) => void;
}

interface LevelState {
  level: HlsLevel;
  variant: HlsVariant;
  playlist: MediaPlaylist | null;
  loading: Promise<MediaPlaylist> | null;
  mime: string;
}

interface Track {
  type: "main" | "audio";
  sb: SourceBuffer;
  mime: string;
  /** Key of the init segment appended last (null = append before the next media segment). */
  initKey: string | null;
  /** Segment appended most recently. */
  last: { level: number; index: number } | null;
  /** Download in flight. */
  loading: { level: number; index: number; start: number; end: number; controller: AbortController } | null;
  busy: boolean;
  appending: boolean;
  /** Bumped by seeks and manual quality changes: work started before them is discarded. */
  generation: number;
  ended: boolean;
  /** Serialises SourceBuffer operations. */
  chain: Promise<void>;
}

interface Fragment {
  start: number;
  end: number;
  level: number;
}

const PLAYLIST_TIMEOUT_MS = 10_000;
const INIT_TIMEOUT_MS = 15_000;
const MAX_SEGMENT_RETRIES = 5;
const MAX_PLAYLIST_RETRIES = 4;
const TICK_MS = 250;
/** Gaps up to this size between buffered ranges are jumped over. */
const MAX_HOLE = 0.5;
const AUDIO_LEVEL = -1;

function isQuotaError(err: unknown): boolean {
  return (err as { name?: string } | null)?.name === "QuotaExceededError";
}

/** Identity of a (possibly byte-ranged) resource, ignoring query tokens that change when URLs are re-signed. */
function rangeKey(uri: string, range: ByteRange | undefined): string {
  let base = uri;
  try {
    const u = new URL(uri);
    base = `${u.origin}${u.pathname}`;
  } catch {
    /* keep as is */
  }
  return range ? `${base}#${range.offset}-${range.length}` : base;
}

function absoluteUrl(url: string): string {
  return new URL(url, window.location.href).href;
}

export class HlsEngine {
  private readonly video: HTMLVideoElement;
  private readonly opts: HlsEngineOptions;
  private readonly estimator: BandwidthEstimator;
  private masterUrl: string;
  private ms: MediaSource | null = null;
  private objectUrl: string | null = null;
  private levelStates: LevelState[] = [];
  private audio: { rendition: HlsMediaRendition; playlist: MediaPlaylist | null; loading: Promise<MediaPlaylist> | null } | null = null;
  private tracks: Track[] = [];
  private initCache = new Map<string, ArrayBuffer>();
  private fragments: Fragment[] = [];
  private manualLevel = -1;
  private loadLevel = -1;
  private playingLevel = -1;
  private emergencyLevel: number | null = null;
  private lastSwitchAt = 0;
  private switches = 0;
  private retries = 0;
  private segmentsLoaded = 0;
  private bytesLoaded = 0;
  private lastSegment: HlsStats["lastSegment"] = null;
  private forwardTarget: number;
  private readonly backBufferTarget: number;
  private pendingStart: number;
  private tickTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;
  private eosSignalled = false;
  private durationSet = false;
  private authPromise: Promise<boolean> | null = null;
  private readonly lifetime = new AbortController();

  constructor(opts: HlsEngineOptions) {
    this.opts = opts;
    this.video = opts.video;
    this.masterUrl = absoluteUrl(opts.masterUrl);
    this.estimator = new BandwidthEstimator({ defaultEstimate: opts.initialBandwidth });
    this.forwardTarget = opts.forwardBuffer ?? 30;
    this.backBufferTarget = opts.backBuffer ?? 60;
    this.pendingStart = Math.max(0, opts.startPosition ?? 0);
  }

  /* ------------------------------------------------------------------ */
  /* Public API                                                          */
  /* ------------------------------------------------------------------ */

  /** Load the playlists and attach to the video element. Errors go to `onFatal`. */
  async start(): Promise<void> {
    try {
      await this.boot();
    } catch (err) {
      this.fail(err);
    }
  }

  get levels(): HlsLevel[] {
    return this.levelStates.map((l) => l.level);
  }

  /** Pin a level (index into `levels`), or -1 for automatic selection. */
  setLevel(index: number): void {
    if (this.destroyed) return;
    const target = index >= 0 && index < this.levelStates.length ? index : -1;
    this.manualLevel = target;
    this.emergencyLevel = null;
    if (target < 0 || target === this.loadLevel) {
      this.schedule(0);
      return;
    }
    const main = this.tracks.find((t) => t.type === "main");
    const current = this.levelStates[this.loadLevel]?.playlist;
    this.loadLevel = target;
    this.lastSwitchAt = performance.now();
    this.switches++;
    if (!main || !current) {
      this.schedule(0);
      return;
    }
    // Keep the segment that is playing, drop what was buffered after it in the old quality.
    this.cancelLoad(main);
    main.generation++;
    const t = this.video.currentTime;
    const info = bufferInfo(toRanges(main.sb.buffered), t, MAX_HOLE);
    const from = info.buffered ? forwardFlushStart(current.segments, t, info.end) : null;
    main.last = null;
    if (from !== null) {
      void this.enqueue(main, () => main.sb.remove(from, Math.max(from + 0.1, this.mediaDuration(info.end))), false)
        .then(() => {
          this.fragments = this.fragments.filter((f) => f.end <= from + 0.05);
        })
        .catch(() => undefined)
        .finally(() => this.schedule(0));
    } else {
      this.schedule(0);
    }
  }

  /** The master URL was re-signed (scheduled token refresh): swap URLs without interrupting playback. */
  updateMasterUrl(url: string): void {
    if (this.destroyed || !url) return;
    const next = absoluteUrl(url);
    if (next === this.masterUrl) return;
    void this.reloadMaster(next).catch(() => undefined);
  }

  getBandwidthEstimate(): number {
    return this.estimator.getEstimate();
  }

  getStats(): HlsStats {
    const t = this.video.currentTime;
    const ranges = toRanges(this.video.buffered);
    const info = bufferInfo(ranges, t, MAX_HOLE);
    return {
      loadingLevel: this.loadLevel,
      playingLevel: this.playingLevel,
      auto: this.manualLevel < 0,
      levels: this.levels,
      estimate: this.estimator.getEstimate(),
      bufferAhead: info.ahead,
      backBuffer: backBufferLength(ranges, t),
      forwardTarget: this.forwardTarget,
      segmentsLoaded: this.segmentsLoaded,
      bytesLoaded: this.bytesLoaded,
      lastSegment: this.lastSegment,
      switches: this.switches,
      retries: this.retries,
      separateAudio: this.tracks.some((tr) => tr.type === "audio"),
    };
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.lifetime.abort();
    if (this.tickTimer !== null) clearTimeout(this.tickTimer);
    this.tickTimer = null;
    const v = this.video;
    v.removeEventListener("seeking", this.onSeeking);
    v.removeEventListener("timeupdate", this.onTimeUpdate);
    v.removeEventListener("playing", this.onPlaying);
    v.removeEventListener("play", this.onPlaying);
    v.removeEventListener("waiting", this.onWaiting);
    for (const track of this.tracks) {
      track.loading?.controller.abort();
      try {
        if (this.ms?.readyState === "open" && track.sb.updating) track.sb.abort();
      } catch {
        /* already detached */
      }
    }
    this.tracks = [];
    this.initCache.clear();
    if (this.objectUrl && v.getAttribute("src") === this.objectUrl) {
      v.removeAttribute("src");
      v.load();
    }
    this.objectUrl = null;
    this.ms = null;
  }

  /* ------------------------------------------------------------------ */
  /* Startup                                                             */
  /* ------------------------------------------------------------------ */

  private async boot(): Promise<void> {
    const MS = mediaSourceCtor();
    if (!MS) throw new HlsFatalError("unsupported", "Media Source Extensions are not available.");

    // A 401/403 on the master (its token expired before playback started) re-signs it once.
    const { text } = await this.loadPlaylistText(() => this.masterUrl, true);
    this.checkAlive();
    this.buildLevels(text, this.masterUrl, MS);
    if (!this.levelStates.length) throw new HlsFatalError("unsupported", "None of the stream's qualities can be decoded by this browser.");
    this.opts.onLevels?.(this.levels);

    const pinned = this.opts.startLevel?.(this.levels) ?? -1;
    this.manualLevel = pinned >= 0 && pinned < this.levelStates.length ? pinned : -1;
    this.loadLevel =
      this.manualLevel >= 0
        ? this.manualLevel
        : chooseLevel({
            levels: this.levelStates.map((l) => l.level),
            current: -1,
            estimate: this.estimator.getEstimate(),
            bufferAhead: 0,
            segmentDuration: 6,
            sinceLastSwitch: Infinity,
            maxHeight: this.opts.capHeight?.(),
            saveData: this.opts.saveData,
          });
    this.lastSwitchAt = performance.now();

    const [playlist] = await Promise.all([this.ensurePlaylist(this.loadLevel), this.audio ? this.ensureAudioPlaylist() : null]);
    this.checkAlive();
    if (playlist.encrypted) throw new HlsFatalError("unsupported", "Encrypted HLS streams are not supported by the built-in engine.");
    if (!playlist.segments[0]?.init) throw new HlsFatalError("unsupported", "This stream uses MPEG-TS segments, which need native HLS playback.");

    const ms = new MS();
    this.ms = ms;
    this.objectUrl = URL.createObjectURL(ms);
    const lifetime = this.lifetime.signal;
    const opened = new Promise<void>((resolve, reject) => {
      const onAbort = () => reject(abortError());
      lifetime.addEventListener("abort", onAbort, { once: true });
      ms.addEventListener(
        "sourceopen",
        () => {
          lifetime.removeEventListener("abort", onAbort);
          resolve();
        },
        { once: true },
      );
    });
    this.video.src = this.objectUrl;
    await opened;
    this.checkAlive();
    // The element holds the MediaSource now; the blob URL is no longer needed.
    URL.revokeObjectURL(this.objectUrl);

    const levelState = this.levelStates[this.loadLevel]!;
    this.tracks.push(this.createTrack("main", levelState.mime));
    if (this.audio) {
      const audioCodecs = splitCodecs(levelState.variant.codecs).audio;
      this.tracks.push(this.createTrack("audio", mp4MimeType(audioCodecs.length ? audioCodecs : ["mp4a.40.2"])));
    }
    if (playlist.endList) this.setDuration(playlist.totalDuration);

    const v = this.video;
    v.addEventListener("seeking", this.onSeeking);
    v.addEventListener("timeupdate", this.onTimeUpdate);
    v.addEventListener("playing", this.onPlaying);
    v.addEventListener("play", this.onPlaying);
    v.addEventListener("waiting", this.onWaiting);
    this.schedule(0);
  }

  private buildLevels(text: string, url: string, MS: typeof MediaSource): void {
    let variants: HlsVariant[];
    let media: HlsMediaRendition[] = [];
    if (isMasterPlaylist(text)) {
      const master = parseMasterPlaylist(text, url);
      variants = master.variants;
      media = master.media;
    } else {
      // A single media playlist: one level whose playlist we already have.
      variants = [{ index: 0, uri: url, bandwidth: 1 }];
    }

    // Separate audio renditions (EXT-X-MEDIA TYPE=AUDIO with a URI) get their own SourceBuffer.
    const group = variants.find((v) => v.audioGroup)?.audioGroup;
    const renditions = group ? media.filter((m) => m.type === "AUDIO" && m.groupId === group && m.uri) : [];
    const rendition = renditions.find((m) => m.isDefault) ?? renditions[0];
    this.audio = rendition ? { rendition, playlist: null, loading: null } : null;

    const states: LevelState[] = [];
    for (const variant of variants) {
      const { video, audio } = splitCodecs(variant.codecs);
      const codecs = this.audio ? video : [...video, ...audio];
      if (!codecs.length) continue;
      const mime = mp4MimeType(codecs);
      if (!MS.isTypeSupported(mime)) continue;
      states.push({
        level: { index: 0, label: variantLabel(variant), width: variant.width, height: variant.height, bandwidth: variant.bandwidth, codecs: codecs.join(",") },
        variant,
        playlist: null,
        loading: null,
        mime,
      });
    }
    states.sort((a, b) => a.level.bandwidth - b.level.bandwidth);
    // Two variants with the same label (e.g. two 720p bitrates) get their bitrate added.
    const counts = new Map<string, number>();
    for (const s of states) counts.set(s.level.label, (counts.get(s.level.label) ?? 0) + 1);
    states.forEach((s, i) => {
      s.level.index = i;
      if ((counts.get(s.level.label) ?? 0) > 1) s.level.label = `${s.level.label} · ${Math.round(s.level.bandwidth / 1000)} kbps`;
    });
    if (!isMasterPlaylist(text) && states[0]) {
      states[0].playlist = parseMediaPlaylist(text, url);
    }
    this.levelStates = states;
  }

  private createTrack(type: Track["type"], mime: string): Track {
    const sb = this.ms!.addSourceBuffer(mime);
    // Resolve pending operations if the element reports a decode error.
    sb.addEventListener("error", () => this.fail(new HlsFatalError("media", "The browser could not decode the video stream.")));
    return { type, sb, mime, initKey: null, last: null, loading: null, busy: false, appending: false, generation: 0, ended: false, chain: Promise.resolve() };
  }

  private setDuration(duration: number): void {
    const ms = this.ms;
    if (!ms || ms.readyState !== "open" || !(duration > 0) || this.tracks.some((t) => t.sb.updating)) return;
    try {
      ms.duration = duration;
      this.durationSet = true;
    } catch {
      /* updating; the next tick sets it */
    }
  }

  private mediaDuration(fallback: number): number {
    const d = this.ms?.duration;
    return d && Number.isFinite(d) ? d : fallback + 3600;
  }

  /* ------------------------------------------------------------------ */
  /* Playlists                                                           */
  /* ------------------------------------------------------------------ */

  private async ensurePlaylist(levelIndex: number): Promise<MediaPlaylist> {
    const state = this.levelStates[levelIndex];
    if (!state) throw new HlsFatalError("parse", "Unknown quality level.");
    if (state.playlist) return state.playlist;
    if (!state.loading) {
      state.loading = this.loadPlaylistText(() => state.variant.uri, true)
        .then(({ text, url }) => {
          const playlist = parseMediaPlaylist(text, url);
          state.playlist = playlist;
          return playlist;
        })
        .finally(() => {
          state.loading = null;
        });
    }
    return state.loading;
  }

  private async ensureAudioPlaylist(): Promise<MediaPlaylist> {
    const audio = this.audio;
    if (!audio?.rendition.uri) throw new HlsFatalError("parse", "The audio rendition has no playlist.");
    if (audio.playlist) return audio.playlist;
    if (!audio.loading) {
      audio.loading = this.loadPlaylistText(() => audio.rendition.uri!, true)
        .then(({ text, url }) => {
          const playlist = parseMediaPlaylist(text, url);
          audio.playlist = playlist;
          return playlist;
        })
        .finally(() => {
          audio.loading = null;
        });
    }
    return audio.loading;
  }

  /** Fetch a playlist with retries; a 401/403 re-signs the master first (when `recoverAuth`). */
  private async loadPlaylistText(url: () => string, recoverAuth: boolean): Promise<{ text: string; url: string }> {
    let authTried = !recoverAuth;
    for (let attempt = 0; ; attempt++) {
      this.checkAlive();
      const target = url();
      try {
        const res = await loadText(target, { timeoutMs: PLAYLIST_TIMEOUT_MS, signal: this.lifetime.signal });
        return res;
      } catch (err) {
        if (isAbortError(err)) throw err;
        const status = err instanceof HttpError ? err.status : 0;
        if ((status === 401 || status === 403) && !authTried && this.opts.refreshMasterUrl) {
          authTried = true;
          if (await this.recoverAuth()) continue;
          throw new HlsFatalError("auth", "Access to this video has expired.");
        }
        if (status === 401 || status === 403) throw new HlsFatalError("auth", "Access to this video was denied.");
        if (status === 404 && attempt >= 1) throw new HlsFatalError("network", "The video stream could not be found.");
        if (attempt + 1 >= MAX_PLAYLIST_RETRIES) throw new HlsFatalError("network", "The video stream could not be loaded.");
        this.retries++;
        await waitOnline(this.lifetime.signal);
        await sleep(retryDelayMs(attempt), this.lifetime.signal);
      }
    }
  }

  /** Re-sign the master URL (single flight) and reload playlist URLs. */
  private recoverAuth(): Promise<boolean> {
    if (!this.opts.refreshMasterUrl) return Promise.resolve(false);
    if (!this.authPromise) {
      this.authPromise = (async () => {
        const url = await this.opts.refreshMasterUrl!();
        if (!url || this.destroyed) return false;
        await this.reloadMaster(absoluteUrl(url));
        return true;
      })()
        .catch(() => false)
        .finally(() => {
          this.authPromise = null;
        });
    }
    return this.authPromise;
  }

  /**
   * Fetch the (re-signed) master again and take over its URLs: variants are
   * matched by their position in the master, loaded media playlists are
   * reloaded so segment URLs carry fresh tokens.
   */
  private async reloadMaster(url: string): Promise<void> {
    const { text } = await loadText(url, { timeoutMs: PLAYLIST_TIMEOUT_MS, signal: this.lifetime.signal });
    this.checkAlive();
    this.masterUrl = url;
    if (!isMasterPlaylist(text)) {
      const state = this.levelStates[0];
      if (state) {
        state.variant = { ...state.variant, uri: url };
        state.playlist = parseMediaPlaylist(text, url);
      }
      return;
    }
    const master = parseMasterPlaylist(text, url);
    const reloads: Promise<unknown>[] = [];
    for (const state of this.levelStates) {
      const fresh = master.variants.find((v) => v.index === state.variant.index);
      if (!fresh) continue;
      state.variant = fresh;
      const wasLoaded = !!state.playlist;
      state.playlist = null;
      if (wasLoaded && state.level.index === this.loadLevel) reloads.push(this.ensurePlaylist(state.level.index));
    }
    if (this.audio) {
      const fresh = master.media.find((m) => m.type === "AUDIO" && m.groupId === this.audio!.rendition.groupId && m.name === this.audio!.rendition.name);
      if (fresh?.uri) {
        this.audio.rendition = fresh;
        this.audio.playlist = null;
        reloads.push(this.ensureAudioPlaylist());
      }
    }
    await Promise.all(reloads);
  }

  /* ------------------------------------------------------------------ */
  /* Loading loop                                                        */
  /* ------------------------------------------------------------------ */

  private schedule(delay: number): void {
    if (this.destroyed) return;
    if (this.tickTimer !== null) clearTimeout(this.tickTimer);
    this.tickTimer = setTimeout(() => {
      this.tickTimer = null;
      this.tick();
    }, delay);
  }

  private tick(): void {
    if (this.destroyed || !this.ms) return;
    if (!this.durationSet) {
      const pl = this.levelStates[this.loadLevel]?.playlist;
      if (pl?.endList) this.setDuration(pl.totalDuration);
    }
    this.jumpGap();
    for (const track of this.tracks) void this.fill(track);
    this.schedule(TICK_MS);
  }

  /** Where loading should continue from: the resume position until playback has really started. */
  private playhead(): number {
    const t = this.video.currentTime;
    if (this.pendingStart > 0 && t < 0.1) return this.pendingStart;
    return t;
  }

  private levelForNextSegment(ahead: number, segmentDuration: number): number {
    if (this.manualLevel >= 0) return this.manualLevel;
    if (this.emergencyLevel !== null) {
      const forced = this.emergencyLevel;
      this.emergencyLevel = null;
      if (forced !== this.loadLevel) this.noteSwitch(forced);
      return forced;
    }
    const conn = typeof navigator !== "undefined" ? (navigator as Navigator & { connection?: { saveData?: boolean } }).connection : undefined;
    const next = chooseLevel({
      levels: this.levelStates.map((l) => l.level),
      current: this.loadLevel,
      estimate: this.estimator.getEstimate(),
      bufferAhead: ahead,
      segmentDuration,
      sinceLastSwitch: (performance.now() - this.lastSwitchAt) / 1000,
      maxHeight: this.opts.capHeight?.(),
      playbackRate: this.video.playbackRate || 1,
      saveData: this.opts.saveData || conn?.saveData,
    });
    if (next !== this.loadLevel) this.noteSwitch(next);
    return next;
  }

  private noteSwitch(level: number): void {
    this.loadLevel = level;
    this.lastSwitchAt = performance.now();
    this.switches++;
  }

  private async fill(track: Track): Promise<void> {
    if (track.busy || this.destroyed || !this.ms || this.ms.readyState === "closed") return;
    track.busy = true;
    const generation = track.generation;
    /** Stop when a seek or a manual quality change happened while awaiting. */
    const current = () => {
      this.checkAlive();
      if (track.generation !== generation) throw abortError();
    };
    try {
      const t = this.playhead();
      await this.evictBuffer(track, t);
      current();
      const info = bufferInfo(toRanges(track.sb.buffered), t, MAX_HOLE);
      if (info.ahead >= this.forwardTarget) return;

      const isMain = track.type === "main";
      const loaded = isMain ? await this.ensurePlaylist(this.loadLevel) : await this.ensureAudioPlaylist();
      current();
      const level = isMain ? this.levelForNextSegment(info.ahead, loaded.targetDuration) : AUDIO_LEVEL;
      const playlist = isMain ? await this.ensurePlaylist(level) : loaded;
      current();

      const index = segmentToLoad(playlist.segments, t, info, track.last?.index ?? null);
      if (index >= playlist.segments.length) {
        if (playlist.endList) {
          track.ended = true;
          await this.maybeEndOfStream();
        }
        return;
      }
      const segment = playlist.segments[index]!;
      if (!segment.init) throw new HlsFatalError("unsupported", "This stream uses MPEG-TS segments, which need native HLS playback.");

      // Init segment (first segment, new quality, or after an aborted append).
      const initKey = rangeKey(segment.init.uri, segment.init.byteRange);
      if (track.initKey !== initKey) {
        const mime = isMain ? this.levelStates[level]!.mime : track.mime;
        if (mime !== track.mime && typeof track.sb.changeType === "function") {
          await this.enqueue(track, () => track.sb.changeType(mime), false);
          track.mime = mime;
        }
        const initData = await this.loadInit(level, index, segment.init);
        current();
        await this.append(track, initData, info.ahead);
        track.initKey = initKey;
      }

      // Media segment.
      const controller = new AbortController();
      track.loading = { level, index, start: segment.start, end: segment.start + segment.duration, controller };
      const lower = isMain && this.manualLevel < 0 && level > 0 ? this.levelStates[level - 1]!.level.bandwidth : null;
      const result = await this.loadSegment(level, index, controller.signal, (loaded, total, elapsed) => {
        if (lower === null) return;
        const now = bufferInfo(toRanges(this.video.buffered), this.video.currentTime, MAX_HOLE);
        if (
          shouldAbandonDownload({
            elapsedMs: elapsed,
            loadedBytes: loaded,
            totalBytes: total,
            segmentDuration: segment.duration,
            bufferAhead: now.ahead,
            lowerLevelBandwidth: lower,
            playbackRate: this.video.playbackRate || 1,
          })
        ) {
          this.estimator.sample(elapsed, loaded);
          this.emergencyLevel = level - 1;
          controller.abort();
        }
      });
      track.loading = null;
      this.estimator.sample(result.ms, result.bytes);
      current();
      await this.append(track, result.data, info.ahead);
      this.eosSignalled = false;
      if (isMain) this.recordFragment({ start: segment.start, end: segment.start + segment.duration, level });
      this.segmentsLoaded++;
      this.bytesLoaded += result.bytes;
      this.lastSegment = { bytes: result.bytes, ms: Math.round(result.ms), level };
      // A seek during the append moved loading elsewhere: keep its bookkeeping.
      current();
      track.last = { level, index };
      track.ended = false;
      if (index === playlist.segments.length - 1 && playlist.endList) {
        track.ended = true;
        await this.maybeEndOfStream();
      }
      this.schedule(0);
    } catch (err) {
      track.loading = null;
      if (isAbortError(err) || this.destroyed) {
        this.schedule(0);
        return;
      }
      if (isQuotaError(err)) {
        // Buffer full even after eviction: wait for playback to consume some of it.
        this.schedule(1000);
        return;
      }
      this.fail(err);
    } finally {
      track.busy = false;
    }
  }

  private async loadInit(level: number, index: number, init: InitSegment): Promise<ArrayBuffer> {
    const key = rangeKey(init.uri, init.byteRange);
    const cached = this.initCache.get(key);
    if (cached) return cached;
    const { data } = await this.loadWithRetry(
      async () => {
        // The URL from the current (possibly re-signed) playlist.
        const playlist = level === AUDIO_LEVEL ? await this.ensureAudioPlaylist() : await this.ensurePlaylist(level);
        const fresh = playlist.segments[index]?.init ?? init;
        return { url: fresh.uri, range: fresh.byteRange };
      },
      { timeoutMs: INIT_TIMEOUT_MS, signal: this.lifetime.signal },
    );
    this.initCache.set(key, data);
    return data;
  }

  private async loadSegment(level: number, index: number, signal: AbortSignal, onProgress: (loaded: number, total: number | null, elapsed: number) => void) {
    const playlistOf = () => (level === AUDIO_LEVEL ? this.ensureAudioPlaylist() : this.ensurePlaylist(level));
    const first = (await playlistOf()).segments[index];
    const timeoutMs = Math.max(20_000, (first?.duration ?? 6) * 4000);
    return this.loadWithRetry(
      async () => {
        const seg = (await playlistOf()).segments[index];
        if (!seg) throw new HlsFatalError("parse", "The stream's segment list changed during playback.");
        return { url: seg.uri, range: seg.byteRange };
      },
      { timeoutMs, signal, onProgress },
    );
  }

  /**
   * Download with retries and exponential backoff. 401/403 re-signs the
   * master once and retries with the refreshed URL (`resolve` is called
   * again for every attempt).
   */
  private async loadWithRetry(
    resolve: () => { url: string; range?: ByteRange } | Promise<{ url: string; range?: ByteRange }>,
    opts: { timeoutMs: number; signal: AbortSignal; onProgress?: (loaded: number, total: number | null, elapsed: number) => void },
  ) {
    let authTried = false;
    for (let attempt = 0; ; attempt++) {
      if (opts.signal.aborted || this.destroyed) throw abortError();
      const { url, range } = await resolve();
      try {
        return await loadBytes(url, { range, signal: opts.signal, timeoutMs: opts.timeoutMs, onProgress: opts.onProgress });
      } catch (err) {
        if (isAbortError(err)) throw err;
        const status = err instanceof HttpError ? err.status : 0;
        if ((status === 401 || status === 403) && !authTried && this.opts.refreshMasterUrl) {
          authTried = true;
          if (await this.recoverAuth()) continue;
          throw new HlsFatalError("auth", "Access to this video has expired.");
        }
        if (status === 401 || status === 403) throw new HlsFatalError("auth", "Access to this video was denied.");
        if (status === 404 && attempt >= 1) throw new HlsFatalError("network", "A part of the video stream is missing.");
        if (attempt + 1 >= MAX_SEGMENT_RETRIES) {
          throw new HlsFatalError("network", err instanceof TimeoutError ? "The video stream timed out." : "The video stream could not be loaded.");
        }
        this.retries++;
        await waitOnline(opts.signal);
        await sleep(retryDelayMs(attempt), opts.signal);
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* SourceBuffer operations                                              */
  /* ------------------------------------------------------------------ */

  /** Run `op` on the track's SourceBuffer after earlier operations, resolving on `updateend`. */
  private enqueue(track: Track, op: () => void, isAppend: boolean): Promise<void> {
    const run = () =>
      new Promise<void>((resolve, reject) => {
        if (this.destroyed || !this.ms || this.ms.readyState === "closed") return reject(abortError());
        const sb = track.sb;
        const cleanup = () => {
          sb.removeEventListener("updateend", onEnd);
          sb.removeEventListener("error", onError);
          sb.removeEventListener("abort", onAbort);
          track.appending = false;
        };
        const onEnd = () => {
          cleanup();
          resolve();
        };
        const onError = () => {
          cleanup();
          reject(new HlsFatalError("media", "The browser could not decode the video stream."));
        };
        const onAbort = () => {
          cleanup();
          reject(abortError());
        };
        sb.addEventListener("updateend", onEnd);
        sb.addEventListener("error", onError);
        sb.addEventListener("abort", onAbort);
        try {
          track.appending = isAppend;
          op();
          // Synchronous operations (changeType) do not fire updateend.
          if (!sb.updating) onEnd();
        } catch (err) {
          cleanup();
          reject(err);
        }
      });
    const result = track.chain.then(run, run);
    track.chain = result.catch(() => undefined);
    return result;
  }

  /** Append, making room on QuotaExceededError (evict behind, shrink the forward target) and trying once more. */
  private async append(track: Track, data: ArrayBuffer, ahead: number): Promise<void> {
    try {
      await this.enqueue(track, () => track.sb.appendBuffer(data), true);
    } catch (err) {
      if (!isQuotaError(err)) throw err;
      const t = this.video.currentTime;
      this.forwardTarget = Math.max(10, Math.min(this.forwardTarget, ahead * 0.8));
      const ranges = toRanges(track.sb.buffered);
      const evict = evictionRange(ranges, t, 10, 0.5);
      if (evict) await this.enqueue(track, () => track.sb.remove(evict.start, evict.end), false);
      await this.enqueue(track, () => track.sb.appendBuffer(data), true);
    }
  }

  /**
   * Keep the SourceBuffer bounded: drop what lies more than the back-buffer
   * target behind the playhead, and ranges far ahead that a backward seek
   * left disconnected from the playhead.
   */
  private async evictBuffer(track: Track, t: number): Promise<void> {
    const ranges = toRanges(track.sb.buffered);
    const removals: TimeRange[] = [];
    const behind = evictionRange(ranges, t, this.backBufferTarget);
    if (behind) removals.push(behind);
    removals.push(...detachedForwardRanges(ranges, t, this.forwardTarget, MAX_HOLE));
    for (const range of removals) {
      await this.enqueue(track, () => track.sb.remove(range.start, range.end), false);
      if (track.type === "main") this.fragments = this.fragments.filter((f) => f.end <= range.start + 0.05 || f.start >= range.end - 0.05);
    }
  }

  private async maybeEndOfStream(): Promise<void> {
    const ms = this.ms;
    if (!ms || this.eosSignalled || ms.readyState !== "open") return;
    if (!this.tracks.every((t) => t.ended)) return;
    await Promise.all(this.tracks.map((t) => t.chain));
    if (this.destroyed || ms.readyState !== "open" || this.tracks.some((t) => t.sb.updating || t.loading)) return;
    try {
      ms.endOfStream();
      this.eosSignalled = true;
    } catch {
      /* a SourceBuffer started updating; retried on the next tick */
    }
  }

  /** Abort the track's download and an append in progress (a removal cannot be aborted). */
  private cancelLoad(track: Track): void {
    track.loading?.controller.abort();
    track.loading = null;
    if (track.appending && track.sb.updating && this.ms?.readyState === "open") {
      try {
        track.sb.abort();
        track.initKey = null;
      } catch {
        /* not abortable right now */
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* Playback events                                                      */
  /* ------------------------------------------------------------------ */

  private readonly onSeeking = () => {
    this.pendingStart = 0;
    const t = this.video.currentTime;
    for (const track of this.tracks) {
      const info = bufferInfo(toRanges(track.sb.buffered), t, MAX_HOLE);
      if (info.buffered) continue;
      const loading = track.loading;
      if (loading && t >= loading.start - 0.1 && t < loading.end) continue;
      this.cancelLoad(track);
      track.generation++;
      track.last = null;
      track.ended = false;
    }
    this.eosSignalled = false;
    this.schedule(0);
  };

  private readonly onPlaying = () => {
    this.pendingStart = 0;
  };

  private readonly onWaiting = () => {
    this.jumpGap();
    this.schedule(0);
  };

  private readonly onTimeUpdate = () => {
    const t = this.video.currentTime;
    const fragment = this.fragments.find((f) => t >= f.start - 0.05 && t < f.end);
    if (fragment && fragment.level !== this.playingLevel) {
      this.playingLevel = fragment.level;
      this.opts.onLevelChange?.(fragment.level);
    }
  };

  /** Step over a small hole between buffered ranges that would otherwise stall playback. */
  private jumpGap(): void {
    const v = this.video;
    if (v.seeking || v.readyState >= 3 || v.ended) return;
    const t = v.currentTime;
    const ranges: TimeRange[] = toRanges(v.buffered);
    if (ranges.some((r) => t >= r.start && t < r.end - 0.05)) return;
    const next = ranges.find((r) => r.start > t && r.start - t <= MAX_HOLE * 2);
    if (next) v.currentTime = next.start + 0.02;
  }

  private recordFragment(f: Fragment): void {
    this.fragments = this.fragments.filter((x) => x.end <= f.start + 0.05 || x.start >= f.end - 0.05);
    this.fragments.push(f);
    if (this.fragments.length > 200) this.fragments.splice(0, this.fragments.length - 200);
    if (this.playingLevel < 0) this.onTimeUpdate();
  }

  /* ------------------------------------------------------------------ */
  /* Errors                                                              */
  /* ------------------------------------------------------------------ */

  private checkAlive(): void {
    if (this.destroyed) throw abortError();
  }

  private fail(err: unknown): void {
    if (this.destroyed || isAbortError(err)) return;
    const fatal =
      err instanceof HlsFatalError
        ? err
        : err instanceof PlaylistParseError
          ? new HlsFatalError("parse", err.message)
          : new HlsFatalError("media", err instanceof Error ? err.message : "The video stream failed.");
    const cb = this.opts.onFatal;
    this.destroy();
    cb?.(fatal);
  }
}
