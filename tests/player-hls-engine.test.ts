import { after, afterEach, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { HlsEngine, type HlsEngineOptions, type HlsFatalError } from "@/components/player/hls/engine";

/**
 * The HLS engine against a small fake of Media Source Extensions: segment
 * bytes are text ("seg:<start>:<end>") that the fake SourceBuffer turns into
 * buffered ranges, and `fetch` serves a one-quality stream of 1-second
 * segments. The fake follows the MSE rules the engine depends on: append and
 * remove are asynchronous (`updateend`), both reopen an "ended" MediaSource,
 * and `endOfStream()` sets it to "ended".
 */

interface Range {
  start: number;
  end: number;
}

class FakeTimeRanges {
  constructor(private readonly ranges: Range[]) {}
  get length() {
    return this.ranges.length;
  }
  start(i: number) {
    return this.ranges[i]!.start;
  }
  end(i: number) {
    return this.ranges[i]!.end;
  }
}

function addRange(list: Range[], add: Range): Range[] {
  const all = [...list, add].sort((a, b) => a.start - b.start);
  const out: Range[] = [];
  for (const r of all) {
    const last = out[out.length - 1];
    if (last && r.start <= last.end + 1e-6) last.end = Math.max(last.end, r.end);
    else out.push({ ...r });
  }
  return out;
}

function removeRange(list: Range[], cut: Range): Range[] {
  return list.flatMap((r) => {
    if (cut.end <= r.start || cut.start >= r.end) return [r];
    const parts: Range[] = [];
    if (cut.start > r.start) parts.push({ start: r.start, end: cut.start });
    if (cut.end < r.end) parts.push({ start: cut.end, end: r.end });
    return parts;
  });
}

class FakeSourceBuffer extends EventTarget {
  updating = false;
  ranges: Range[] = [];
  constructor(private readonly ms: FakeMediaSource) {
    super();
  }
  get buffered() {
    return new FakeTimeRanges(this.ranges);
  }
  appendBuffer(data: ArrayBuffer) {
    const text = new TextDecoder().decode(data);
    this.run(() => {
      const m = /^seg:([\d.]+):([\d.]+)$/.exec(text);
      if (m) this.ranges = addRange(this.ranges, { start: Number(m[1]), end: Number(m[2]) });
    });
  }
  remove(start: number, end: number) {
    this.run(() => {
      this.ranges = removeRange(this.ranges, { start, end });
    });
  }
  abort() {}
  changeType() {}
  private run(fn: () => void) {
    if (this.updating) throw new DOMException("A SourceBuffer operation is running.", "InvalidStateError");
    // MSE: appendBuffer() and remove() on an "ended" MediaSource set it back to "open".
    if (this.ms.readyState === "ended") this.ms.reopen();
    this.updating = true;
    setTimeout(() => {
      fn();
      this.updating = false;
      this.dispatchEvent(new Event("updateend"));
    }, 1);
  }
}

class FakeMediaSource extends EventTarget {
  static isTypeSupported() {
    return true;
  }
  readyState: "closed" | "open" | "ended" = "closed";
  duration = NaN;
  buffers: FakeSourceBuffer[] = [];
  endCount = 0;
  reopenCount = 0;
  addSourceBuffer() {
    const sb = new FakeSourceBuffer(this);
    this.buffers.push(sb);
    return sb;
  }
  endOfStream() {
    if (this.readyState !== "open" || this.buffers.some((b) => b.updating)) throw new DOMException("Not open.", "InvalidStateError");
    this.readyState = "ended";
    this.endCount++;
  }
  reopen() {
    this.readyState = "open";
    this.reopenCount++;
  }
}

const objectUrls = new Map<string, FakeMediaSource>();

class FakeVideo extends EventTarget {
  currentTime = 0;
  paused = true;
  ended = false;
  seeking = false;
  readyState = 0;
  playbackRate = 1;
  ms: FakeMediaSource | null = null;
  private srcAttr: string | null = null;
  set src(value: string) {
    this.srcAttr = value;
    const ms = objectUrls.get(value);
    if (ms) {
      this.ms = ms;
      setTimeout(() => {
        ms.readyState = "open";
        ms.dispatchEvent(new Event("sourceopen"));
      }, 0);
    }
  }
  getAttribute(name: string) {
    return name === "src" ? this.srcAttr : null;
  }
  removeAttribute() {
    this.srcAttr = null;
  }
  /** The media element load algorithm: the position goes back to 0. */
  load() {
    this.currentTime = 0;
    this.paused = true;
    if (this.ms) this.ms.readyState = "closed";
    this.ms = null;
  }
  get buffered() {
    return new FakeTimeRanges(this.ms?.buffers[0]?.ranges ?? []);
  }
}

/* ------------------------------------------------------------------ */
/* Stream served by the fake fetch                                      */
/* ------------------------------------------------------------------ */

const ORIGIN = "https://lms.test";
const SEGMENTS = 20;

const MASTER = `#EXTM3U
#EXT-X-VERSION:7
#EXT-X-STREAM-INF:BANDWIDTH=1000000,RESOLUTION=1280x720,CODECS="avc1.64001f,mp4a.40.2"
v.m3u8
`;

function mediaPlaylist(): string {
  const lines = ["#EXTM3U", "#EXT-X-VERSION:7", "#EXT-X-TARGETDURATION:1", "#EXT-X-PLAYLIST-TYPE:VOD", '#EXT-X-MAP:URI="init.mp4"'];
  for (let i = 0; i < SEGMENTS; i++) lines.push("#EXTINF:1.000000,", `s${i}.m4s`);
  lines.push("#EXT-X-ENDLIST", "");
  return lines.join("\n");
}

type Responder = (url: URL) => Response | null;

let requests: string[] = [];
let responder: Responder | null = null;

function serve(url: URL): Response {
  const custom = responder?.(url);
  if (custom) return custom;
  const name = url.pathname.split("/").pop() ?? "";
  if (name === "master.m3u8") return new Response(MASTER);
  if (name === "v.m3u8") return new Response(mediaPlaylist());
  if (name === "init.mp4") return new Response("init");
  const m = /^s(\d+)\.m4s$/.exec(name);
  if (m) return new Response(`seg:${Number(m[1])}:${Number(m[1]) + 1}`);
  return new Response("not found", { status: 404 });
}

const realFetch = globalThis.fetch;
const realCreate = URL.createObjectURL;
const realRevoke = URL.revokeObjectURL;
const g = globalThis as unknown as { window?: unknown };
let urlCount = 0;
let engines: HlsEngine[] = [];

before(() => {
  g.window = {
    location: { href: `${ORIGIN}/learn/course/lesson` },
    MediaSource: FakeMediaSource,
    addEventListener() {},
    removeEventListener() {},
  };
  URL.createObjectURL = ((ms: FakeMediaSource) => {
    const url = `blob:${ORIGIN}/ms-${++urlCount}`;
    objectUrls.set(url, ms);
    return url;
  }) as unknown as typeof URL.createObjectURL;
  URL.revokeObjectURL = () => undefined;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    requests.push(url.href);
    await new Promise((r) => setTimeout(r, 2));
    return serve(url);
  }) as typeof fetch;
});

after(() => {
  delete g.window;
  URL.createObjectURL = realCreate;
  URL.revokeObjectURL = realRevoke;
  globalThis.fetch = realFetch;
});

afterEach(() => {
  for (const e of engines) e.destroy();
  engines = [];
  requests = [];
  responder = null;
});

function startEngine(video: FakeVideo, opts: Partial<HlsEngineOptions> = {}): HlsEngine {
  const engine = new HlsEngine({
    video: video as unknown as HTMLVideoElement,
    masterUrl: `${ORIGIN}/hls/master.m3u8?t=1`,
    initialBandwidth: 5_000_000,
    forwardBuffer: 3,
    backBuffer: 2,
    ...opts,
  });
  engines.push(engine);
  void engine.start();
  return engine;
}

async function waitFor(what: string, cond: () => boolean, timeoutMs = 5000): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (!cond()) {
    if (Date.now() > until) throw new Error(`Timed out waiting for ${what}.`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

function covered(video: FakeVideo, start: number, end: number): boolean {
  return (video.ms?.buffers[0]?.ranges ?? []).some((r) => r.start <= start + 1e-6 && r.end >= end - 1e-6);
}

describe("player-hls engine: end of stream", () => {
  it("keeps the MediaSource ended (no back-buffer eviction reopens it) so the element can fire `ended`", async () => {
    const video = new FakeVideo();
    startEngine(video);
    await waitFor("the first segments", () => covered(video, 0, 3));

    video.currentTime = 12;
    await waitFor("segments around 12 s", () => covered(video, 12, 15));

    video.currentTime = 17;
    await waitFor("the end of the stream", () => video.ms?.readyState === "ended");
    assert.ok(covered(video, 17, 20));

    // Near the end more than backBuffer + 5 s lie behind the playhead: the old engine removed them,
    // which reopened the MediaSource and never signalled the end again.
    video.currentTime = 19.5;
    await delay(800);
    assert.equal(video.ms?.readyState, "ended");
    assert.equal(video.ms?.reopenCount, 0);
  });

  it("signals the end again after a seek reopened the stream", async () => {
    const video = new FakeVideo();
    startEngine(video, { startPosition: 17 });
    await waitFor("the end of the stream", () => video.ms?.readyState === "ended");
    const ends = video.ms!.endCount;

    // Seek back into a region that is not buffered: the new appends reopen the MediaSource.
    video.currentTime = 5;
    video.dispatchEvent(new Event("seeking"));
    await waitFor("segments around 5 s", () => covered(video, 5, 8));
    assert.equal(video.ms?.readyState, "open");

    video.currentTime = 18;
    video.dispatchEvent(new Event("seeking"));
    await waitFor("the end of the stream again", () => video.ms?.readyState === "ended");
    assert.ok(video.ms!.endCount > ends);
  });
});

describe("player-hls engine: fatal errors", () => {
  it("reports where playback was before detaching resets the element to 0", async () => {
    const video = new FakeVideo();
    responder = (url) => (/^\/hls\/s(?:[6-9]|1\d)\.m4s$/.test(url.pathname) ? new Response("expired", { status: 403 }) : null);
    let fatal: HlsFatalError | null = null;
    startEngine(video, { refreshMasterUrl: async () => null, onFatal: (e) => (fatal = e) });
    await waitFor("the first segments", () => covered(video, 0, 3));

    video.currentTime = 5.5;
    video.paused = false;
    await waitFor("the fatal error", () => fatal !== null);
    const error = fatal as unknown as HlsFatalError;
    assert.equal(error.reason, "auth");
    assert.equal(error.position, 5.5);
    assert.equal(error.wasPlaying, true);
    // The engine detached (load() reset the element): the fallback must use `position`, not currentTime.
    assert.equal(video.currentTime, 0);
  });

  it("reports the resume position when it fails before playback started", async () => {
    const video = new FakeVideo();
    responder = (url) => (url.pathname.endsWith(".m4s") ? new Response("gone", { status: 403 }) : null);
    let fatal: HlsFatalError | null = null;
    startEngine(video, { startPosition: 12, refreshMasterUrl: async () => null, onFatal: (e) => (fatal = e) });
    await waitFor("the fatal error", () => fatal !== null);
    assert.equal((fatal as unknown as HlsFatalError).position, 12);
    assert.equal((fatal as unknown as HlsFatalError).wasPlaying, false);
  });
});

describe("player-hls engine: 403 recovery", () => {
  const FRESH = `${ORIGIN}/hls/master.m3u8?t=2`;
  const expiredAfter3 = (url: URL) => (url.searchParams.get("t") === "1" && /^s(?:[3-9]|1\d)\.m4s$/.test(url.pathname.split("/").pop() ?? "") ? new Response("expired", { status: 403 }) : null);

  for (const order of ["after", "before"] as const) {
    it(`reloads the re-signed playlists once when the URL hook also reports the new URL (${order} the refresh resolves)`, async () => {
      const video = new FakeVideo();
      responder = expiredAfter3;
      let engine: HlsEngine | null = null;
      let refreshes = 0;
      // Like the player: the refresh re-signs, and the re-render hands the new URL to updateMasterUrl.
      const refreshMasterUrl = async () => {
        refreshes++;
        if (order === "before") engine!.updateMasterUrl(FRESH);
        else setTimeout(() => engine!.updateMasterUrl(FRESH), 0);
        return FRESH;
      };
      engine = startEngine(video, { refreshMasterUrl });
      await waitFor("the first segments", () => covered(video, 0, 3));
      video.currentTime = 2.5;
      await waitFor("segments after the token expired", () => covered(video, 2.5, 5.5));
      await delay(50);

      assert.equal(refreshes, 1);
      assert.equal(requests.filter((u) => u === FRESH).length, 1, "master playlist fetched once with the new token");
      assert.equal(requests.filter((u) => u === `${ORIGIN}/hls/v.m3u8?t=2`).length, 1, "media playlist fetched once with the new token");
      assert.ok(requests.includes(`${ORIGIN}/hls/s3.m4s?t=2`));
    });
  }

  it("still swaps to a URL from a scheduled refresh", async () => {
    const video = new FakeVideo();
    const engine = startEngine(video);
    await waitFor("the first segments", () => covered(video, 0, 3));
    engine.updateMasterUrl(FRESH);
    engine.updateMasterUrl(FRESH);
    await waitFor("the new media playlist", () => requests.includes(`${ORIGIN}/hls/v.m3u8?t=2`));
    await delay(30);
    assert.equal(requests.filter((u) => u === FRESH).length, 1);
    video.currentTime = 2.5;
    await waitFor("segments with the new token", () => requests.includes(`${ORIGIN}/hls/s3.m4s?t=2`));
  });
});
