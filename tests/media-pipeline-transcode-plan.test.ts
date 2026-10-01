import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { LessonBlock } from "@/lib/types";
import {
  FfmpegProgressParser,
  MASTER_PLAYLIST,
  POSTER_FILE,
  SEGMENT_SECONDS,
  buildHlsPlan,
  buildPosterArgs,
  codecString,
  h264Level,
  normalizeRenditions,
  parseClock,
  parseProbe,
  profileFor,
  progressPercent,
  renditionLadder,
  scaledWidth,
  tailText,
  type ProbeInfo,
} from "@/lib/media/transcode/plan";
import {
  hlsKeyPrefix,
  hlsMatchesSource,
  hlsVersionPrefix,
  pendingState,
  preserveManagedVideoFields,
  renditionLabel,
  transcodeSourceKey,
} from "@/lib/media/transcode/lesson-fields";

/** HLS conversion planning: rendition ladder, codec strings, ffprobe parsing, ffmpeg arguments and progress parsing. */

const PROBE_1080: ProbeInfo = { duration: 600, width: 1920, height: 1080, fps: 30, hasVideo: true, hasAudio: true, videoCodec: "h264", sizeBytes: 50_000_000 };

/** Value following `flag` in an argument list (the n-th occurrence). */
function argAfter(args: string[], flag: string, nth = 0): string | undefined {
  let seen = 0;
  for (let i = 0; i < args.length - 1; i++) {
    if (args[i] === flag && seen++ === nth) return args[i + 1];
  }
  return undefined;
}

function count(args: string[], value: string): number {
  return args.filter((a) => a === value).length;
}

describe("rendition ladder", () => {
  it("keeps supported heights only, unique and highest first", () => {
    assert.deepEqual(normalizeRenditions([480, "720", 1080, 720, 999, -1, null]), [1080, 720, 480]);
    assert.deepEqual(normalizeRenditions([360]), [360]);
  });

  it("falls back when nothing usable is configured", () => {
    assert.deepEqual(normalizeRenditions([]), [1080, 720, 480]);
    assert.deepEqual(normalizeRenditions(undefined, [720]), [720]);
    assert.deepEqual(normalizeRenditions(["x", 2160]), [1080, 720, 480]);
  });

  it("never upscales the source", () => {
    assert.deepEqual(renditionLadder({ height: 1080 }, [1080, 720, 480]), [1080, 720, 480]);
    assert.deepEqual(renditionLadder({ height: 720 }, [1080, 720, 480, 360]), [720, 480, 360]);
    assert.deepEqual(renditionLadder({ height: 2160 }, [720, 480]), [720, 480]);
    assert.deepEqual(renditionLadder({ height: 500 }, [1080, 720, 480]), [480]);
  });

  it("gives a small source one rendition at its own even height", () => {
    assert.deepEqual(renditionLadder({ height: 241 }, [1080, 720, 480, 360]), [240]);
    assert.deepEqual(renditionLadder({ height: 300 }, [480]), [300]);
    assert.deepEqual(renditionLadder({ height: 0 }, [480]), []);
    assert.deepEqual(renditionLadder({ height: 1 }, [480]), []);
  });

  it("scales the width with the aspect ratio, always even", () => {
    assert.equal(scaledWidth({ width: 1920, height: 1080 }, 720), 1280);
    assert.equal(scaledWidth({ width: 1920, height: 1080 }, 480), 852);
    assert.equal(scaledWidth({ width: 1080, height: 1920 }, 720), 404);
    assert.equal(scaledWidth({ width: 1440, height: 1080 }, 360), 480);
    assert.equal(scaledWidth({ width: 0, height: 0 }, 720), 1280);
    for (const h of [1080, 720, 480, 360]) assert.equal(scaledWidth({ width: 1001, height: 563 }, h) % 2, 0);
  });

  it("uses the profile of a height, and scales odd heights from the profile below", () => {
    assert.equal(profileFor(1080).maxrateKbps, 5000);
    assert.equal(profileFor(720).profile, "high");
    assert.equal(profileFor(360).profile, "main");
    const odd = profileFor(300);
    assert.equal(odd.height, 300);
    assert.equal(odd.crf, profileFor(240).crf);
    assert.equal(odd.maxrateKbps, Math.round(450 * (300 / 240)));
    const tiny = profileFor(100);
    assert.equal(tiny.maxrateKbps, Math.round(450 * 0.5));
    // Lower renditions never get a higher bit rate ceiling than higher ones.
    const ladder = [1080, 720, 480, 360].map((h) => profileFor(h).maxrateKbps);
    assert.deepEqual([...ladder].sort((a, b) => b - a), ladder);
  });
});

describe("H.264 levels and codec strings", () => {
  it("picks the smallest level that fits the frame size and rate", () => {
    assert.equal(h264Level(640, 360, 30), 30);
    assert.equal(h264Level(1280, 720, 30), 31);
    assert.equal(h264Level(1280, 720, 60), 32);
    assert.equal(h264Level(1920, 1080, 30), 41);
    assert.equal(h264Level(1920, 1080, 60), 42);
    assert.equal(h264Level(3840, 2160, 30), 51);
    assert.equal(h264Level(7680, 4320, 30), 52);
  });

  it("treats an unknown frame rate as 30 fps", () => {
    assert.equal(h264Level(1920, 1080, 0), h264Level(1920, 1080, 30));
  });

  it("writes RFC 6381 codec strings", () => {
    assert.equal(codecString("high", 31, true), "avc1.64001f,mp4a.40.2");
    assert.equal(codecString("main", 30, false), "avc1.4d401e");
    assert.equal(codecString("high", 41, false), "avc1.640029");
  });
});

describe("parseProbe", () => {
  const base = {
    streams: [
      { index: 0, codec_type: "video", codec_name: "h264", width: 1920, height: 1080, avg_frame_rate: "30000/1001", r_frame_rate: "30000/1001", duration: "12.5" },
      { index: 1, codec_type: "audio", codec_name: "aac", duration: "12.4" },
    ],
    format: { duration: "12.512", size: "1048576" },
  };

  it("reads size, duration, frame rate and tracks", () => {
    const info = parseProbe(base);
    assert.equal(info.width, 1920);
    assert.equal(info.height, 1080);
    assert.equal(info.duration, 12.512);
    assert.ok(Math.abs(info.fps - 29.97) < 0.01);
    assert.equal(info.hasVideo, true);
    assert.equal(info.hasAudio, true);
    assert.equal(info.videoCodec, "h264");
    assert.equal(info.sizeBytes, 1048576);
  });

  it("swaps width and height for rotated phone videos (tag and side data)", () => {
    const tagged = parseProbe({ ...base, streams: [{ ...base.streams[0], tags: { rotate: "90" } }] });
    assert.deepEqual([tagged.width, tagged.height], [1080, 1920]);
    const side = parseProbe({ ...base, streams: [{ ...base.streams[0], side_data_list: [{ side_data_type: "Display Matrix", rotation: -90 }] }] });
    assert.deepEqual([side.width, side.height], [1080, 1920]);
    const flipped = parseProbe({ ...base, streams: [{ ...base.streams[0], tags: { rotate: "180" } }] });
    assert.deepEqual([flipped.width, flipped.height], [1920, 1080]);
  });

  it("ignores cover art and falls back to stream durations and r_frame_rate", () => {
    const info = parseProbe({
      streams: [
        { codec_type: "video", codec_name: "mjpeg", width: 600, height: 600, disposition: { attached_pic: 1 } },
        { codec_type: "video", codec_name: "hevc", width: 1280, height: 720, avg_frame_rate: "0/0", r_frame_rate: "25/1", duration: "42" },
      ],
      format: {},
    });
    assert.equal(info.videoCodec, "hevc");
    assert.equal(info.height, 720);
    assert.equal(info.fps, 25);
    assert.equal(info.duration, 42);
    assert.equal(info.hasAudio, false);
    assert.equal(info.sizeBytes, null);
  });

  it("reports an audio-only file as having no video", () => {
    const info = parseProbe({ streams: [{ codec_type: "audio", duration: "3" }], format: { duration: "3" } });
    assert.equal(info.hasVideo, false);
    assert.equal(info.hasAudio, true);
    assert.equal(info.duration, 3);
  });

  it("survives garbage", () => {
    for (const junk of [null, undefined, 42, "x", [], { streams: "no" }, { streams: [null], format: null }]) {
      const info = parseProbe(junk);
      assert.equal(info.hasVideo, false);
      assert.equal(info.duration, 0);
      assert.equal(info.fps, 0);
    }
    assert.equal(parseProbe({ streams: [{ codec_type: "video", width: 640, height: 360, avg_frame_rate: "1/0" }] }).fps, 1);
    assert.equal(parseProbe({ streams: [{ codec_type: "video", width: 640, height: 360, avg_frame_rate: "90000/1" }] }).fps, 0);
  });
});

describe("buildHlsPlan", () => {
  it("encodes every rendition from one decode into fMP4 HLS with aligned segments", () => {
    const plan = buildHlsPlan("C:\\media\\in.mp4", PROBE_1080, [1080, 720, 480]);
    const { args } = plan;
    assert.equal(argAfter(args, "-i"), "C:\\media\\in.mp4");
    assert.equal(argAfter(args, "-progress"), "pipe:1");
    assert.ok(args.includes("-nostdin"));
    const graph = argAfter(args, "-filter_complex")!;
    assert.match(graph, /^\[0:v\]split=3\[s0\]\[s1\]\[s2\];/);
    assert.match(graph, /\[s0\]scale=1920:1080:flags=bicubic,setsar=1,format=yuv420p\[v0\]/);
    assert.match(graph, /\[s1\]scale=1280:720:.*\[v1\]/);
    assert.match(graph, /\[s2\]scale=852:480:.*\[v2\]/);

    assert.equal(count(args, "-f"), 3);
    assert.equal(count(args, "hls"), 3);
    assert.equal(count(args, "fmp4"), 3);
    assert.equal(count(args, "independent_segments"), 3);
    assert.equal(count(args, "vod"), 3);
    assert.equal(argAfter(args, "-hls_time"), String(SEGMENT_SECONDS));
    assert.equal(argAfter(args, "-force_key_frames"), `expr:gte(t,n_forced*${SEGMENT_SECONDS})`);
    assert.equal(argAfter(args, "-sc_threshold"), "0");
    assert.equal(argAfter(args, "-hls_fmp4_init_filename"), "init.mp4");
    assert.deepEqual([0, 1, 2].map((n) => argAfter(args, "-hls_segment_filename", n)), ["1080p/seg_%05d.m4s", "720p/seg_%05d.m4s", "480p/seg_%05d.m4s"]);
    assert.deepEqual([0, 1, 2].map((n) => argAfter(args, "-map", n * 2)), ["[v0]", "[v1]", "[v2]"]);
    assert.equal(count(args, "0:a:0"), 3);
    assert.equal(count(args, "libx264"), 3);
    assert.equal(count(args, "aac"), 3);
    assert.deepEqual([0, 1, 2].map((n) => argAfter(args, "-maxrate", n)), ["5000k", "2800k", "1400k"]);
    assert.deepEqual([0, 1, 2].map((n) => argAfter(args, "-level:v", n)), ["4.1", "3.1", "3.1"]);
    assert.equal(args.at(-1), "480p/index.m3u8");
    // Output paths use forward slashes on every platform.
    assert.ok(!args.some((a) => a.includes("p\\")));
  });

  it("describes each variant for the master playlist", () => {
    const plan = buildHlsPlan("in.mp4", PROBE_1080, [720, 360]);
    assert.deepEqual(
      plan.variants.map((v) => ({ height: v.height, width: v.width, dir: v.dir, playlist: v.playlist, codecs: v.codecs })),
      [
        { height: 720, width: 1280, dir: "720p", playlist: "720p/index.m3u8", codecs: "avc1.64001f,mp4a.40.2" },
        { height: 360, width: 640, dir: "360p", playlist: "360p/index.m3u8", codecs: "avc1.4d401e,mp4a.40.2" },
      ],
    );
  });

  it("skips the split filter for one rendition and the audio options without audio", () => {
    const { args, variants } = buildHlsPlan("in.mov", { ...PROBE_1080, hasAudio: false }, [720]);
    const graph = argAfter(args, "-filter_complex")!;
    assert.ok(!graph.includes("split"));
    assert.match(graph, /^\[0:v\]scale=1280:720/);
    assert.ok(!args.includes("0:a:0"));
    assert.ok(!args.includes("-c:a"));
    assert.equal(variants[0]!.codecs, "avc1.64001f");
  });

  it("caps very high frame rates at 60 fps and honours plan options", () => {
    const fast = buildHlsPlan("in.mp4", { ...PROBE_1080, fps: 120 }, [1080], { segmentSeconds: 4, preset: "medium" });
    assert.equal(argAfter(fast.args, "-r"), "60");
    assert.equal(argAfter(fast.args, "-hls_time"), "4");
    assert.equal(argAfter(fast.args, "-preset"), "medium");
    assert.equal(fast.variants[0]!.level, 42);
    assert.equal(argAfter(buildHlsPlan("in.mp4", PROBE_1080, [1080]).args, "-r"), undefined);
  });

  it("names the master playlist and poster consistently", () => {
    assert.equal(MASTER_PLAYLIST, "master.m3u8");
    assert.equal(POSTER_FILE, "poster.jpg");
  });
});

describe("buildPosterArgs", () => {
  it("grabs one frame 10% in, at most 30 s, at most 720 high", () => {
    const args = buildPosterArgs("in.mp4", PROBE_1080);
    assert.equal(argAfter(args, "-ss"), "30.00");
    assert.equal(argAfter(args, "-frames:v"), "1");
    assert.equal(argAfter(args, "-vf"), "scale=-2:720");
    assert.equal(args.at(-1), POSTER_FILE);
    assert.ok(args.indexOf("-ss") < args.indexOf("-i"), "seek before the input for speed");
  });

  it("handles short, small and unknown-length videos", () => {
    assert.equal(argAfter(buildPosterArgs("in.mp4", { ...PROBE_1080, duration: 20 }), "-ss"), "2.00");
    assert.equal(argAfter(buildPosterArgs("in.mp4", { ...PROBE_1080, duration: 0 }), "-ss"), "1.00");
    assert.equal(argAfter(buildPosterArgs("in.mp4", { ...PROBE_1080, height: 361 }), "-vf"), "scale=-2:360");
    assert.equal(argAfter(buildPosterArgs("in.mp4", { ...PROBE_1080, height: 0 }), "-vf"), "scale=-2:720");
  });
});

describe("FfmpegProgressParser", () => {
  const block = (us: number, speed: string, progress = "continue") =>
    `frame=10\nfps=30.0\nout_time_us=${us}\nout_time_ms=${us}\nout_time=00:00:00.000000\nspeed=${speed}\nprogress=${progress}\n`;

  it("reports a state for each finished block", () => {
    const p = new FfmpegProgressParser();
    assert.deepEqual(p.push(block(1_500_000, "2.5x")), { outTime: 1.5, speed: 2.5, done: false });
    assert.deepEqual(p.push(block(3_000_000, "3x", "end")), { outTime: 3, speed: 3, done: true });
  });

  it("keeps partial lines between chunks, including CRLF", () => {
    const p = new FfmpegProgressParser();
    const text = block(4_250_000, "1.25x").replace(/\n/g, "\r\n");
    let result = null;
    for (let i = 0; i < text.length; i += 7) {
      const update = p.push(text.slice(i, i + 7));
      if (update) result = update;
    }
    assert.deepEqual(result, { outTime: 4.25, speed: 1.25, done: false });
  });

  it("returns null until a block ends", () => {
    const p = new FfmpegProgressParser();
    assert.equal(p.push("out_time_us=1000000\nspeed=1x\n"), null);
    assert.equal(p.current.outTime, 1);
    assert.deepEqual(p.push("progress=continue\n"), { outTime: 1, speed: 1, done: false });
  });

  it("falls back to the out_time clock and ignores N/A values", () => {
    const p = new FfmpegProgressParser();
    assert.deepEqual(p.push("out_time_us=N/A\nout_time=00:01:02.500000\nspeed=N/A\nprogress=continue\n"), { outTime: 62.5, speed: null, done: false });
    assert.deepEqual(p.push("out_time=-577014:32:22.775808\nprogress=continue\n"), { outTime: 62.5, speed: null, done: false });
  });

  it("ignores noise lines", () => {
    const p = new FfmpegProgressParser();
    assert.deepEqual(p.push("garbage\n\n=\nbitrate=N/A\nout_time_us=-5\nprogress=continue\n"), { outTime: 0, speed: null, done: false });
  });
});

describe("progress helpers", () => {
  it("parses clock values", () => {
    assert.equal(parseClock("01:02:03.500000"), 3723.5);
    assert.equal(parseClock("00:00:07"), 7);
    assert.equal(parseClock("N/A"), null);
    assert.equal(parseClock("-00:00:01.000000"), null);
    assert.equal(parseClock("1:2:3"), null);
  });

  it("computes whole percent, never 100 while running", () => {
    assert.equal(progressPercent(30, 60), 50);
    assert.equal(progressPercent(59.99, 60), 99);
    assert.equal(progressPercent(61, 60), 99);
    assert.equal(progressPercent(10, 0), 0);
    assert.equal(progressPercent(0, 60), 0);
    assert.equal(progressPercent(Number.NaN, 60), 0);
    assert.equal(progressPercent(-3, 60), 0);
  });

  it("keeps the end of long logs", () => {
    assert.equal(tailText("  short\r\n "), "short");
    const long = `${"a".repeat(50)}END`;
    const tail = tailText(long, 10);
    assert.equal(tail.length, 10);
    assert.ok(tail.startsWith("…"));
    assert.ok(tail.endsWith("aaaaaEND"));
  });
});

describe("lesson video fields", () => {
  it("builds storage prefixes from safe ids only", () => {
    assert.equal(hlsKeyPrefix("les_1", "blk_2"), "videos/les_1/blk_2/hls/");
    assert.throws(() => hlsKeyPrefix("../x", "blk"));
    assert.throws(() => hlsKeyPrefix("les", "a/b"));
    assert.throws(() => hlsKeyPrefix("", "b"));
  });

  it("only converts uploaded video files, never HLS output or external links", () => {
    assert.equal(transcodeSourceKey("/uploads/videos/lecture.mp4"), "videos/lecture.mp4");
    assert.equal(transcodeSourceKey("/uploads/videos/Clip.MOV"), "videos/Clip.MOV");
    assert.equal(transcodeSourceKey("http://localhost:3000/uploads/videos/a.webm", ["http://localhost:3000"]), "videos/a.webm");
    assert.equal(transcodeSourceKey("https://cdn.example.com/a.mp4"), null);
    assert.equal(transcodeSourceKey("/uploads/videos/a.mp3"), null);
    assert.equal(transcodeSourceKey("/uploads/videos/l/b/hls/v1/720p/x.mp4"), null);
    assert.equal(transcodeSourceKey(undefined), null);
    assert.equal(transcodeSourceKey(""), null);
  });

  it("finds the version folder of an hlsUrl", () => {
    assert.equal(hlsVersionPrefix("/uploads/videos/l1/b1/hls/v9/master.m3u8"), "videos/l1/b1/hls/v9/");
    assert.equal(hlsVersionPrefix("/uploads/videos/a.mp4"), null);
    assert.equal(hlsVersionPrefix(undefined), null);
  });

  it("knows whether HLS output belongs to the current file", () => {
    const block = { src: "/uploads/videos/a.mp4", hlsUrl: "/uploads/videos/l/b/hls/v/master.m3u8", storageKey: "videos/a.mp4" };
    assert.equal(hlsMatchesSource(block), true);
    assert.equal(hlsMatchesSource({ ...block, src: "/uploads/videos/b.mp4" }), false);
    assert.equal(hlsMatchesSource({ ...block, hlsUrl: undefined }), false);
  });

  it("labels renditions highest first", () => {
    assert.equal(renditionLabel([480, 1080, 720]), "1080p/720p/480p");
    assert.equal(renditionLabel([]), "");
  });

  it("keeps finished renditions while a new conversion is pending", () => {
    const state = pendingState({ status: "ready", progress: 100, renditions: [{ height: 720, bandwidth: 2_000_000 }], updatedAt: "x" }, "now");
    assert.deepEqual(state, { status: "pending", progress: 0, renditions: [{ height: 720, bandwidth: 2_000_000 }], updatedAt: "now" });
  });

  describe("preserveManagedVideoFields", () => {
    const stored: LessonBlock[] = [
      {
        id: "v1",
        type: "video",
        src: "/uploads/videos/a.mp4",
        hlsUrl: "/uploads/videos/l/v1/hls/x/master.m3u8",
        storageKey: "videos/a.mp4",
        transcode: { status: "ready", progress: 100, updatedAt: "t" },
        transcriptId: "tr_1",
        duration: 120,
        posterUrl: "/uploads/posters/l/v1-x.jpg",
      },
      { id: "m1", type: "markdown", content: "Hi" },
    ];

    it("carries managed fields over for the same file and ignores client values", () => {
      const next: LessonBlock[] = [
        { id: "v1", type: "video", src: "/uploads/videos/a.mp4", hlsUrl: "/evil.m3u8", transcriptId: "forged", title: "Intro" },
        { id: "m1", type: "markdown", content: "Hi there" },
      ];
      const [video, md] = preserveManagedVideoFields(stored, next);
      assert.equal(video!.type, "video");
      if (video!.type !== "video") return;
      assert.equal(video!.hlsUrl, "/uploads/videos/l/v1/hls/x/master.m3u8");
      assert.equal(video!.transcriptId, "tr_1");
      assert.equal(video!.storageKey, "videos/a.mp4");
      assert.equal(video!.transcode?.status, "ready");
      assert.equal(video!.duration, 120);
      assert.equal(video!.posterUrl, "/uploads/posters/l/v1-x.jpg");
      assert.equal(video!.title, "Intro");
      assert.deepEqual(md, next[1]);
    });

    it("keeps an editor's own duration and poster", () => {
      const [video] = preserveManagedVideoFields(stored, [{ id: "v1", type: "video", src: "/uploads/videos/a.mp4", duration: 90, posterUrl: "/uploads/p.jpg" }]);
      assert.ok(video!.type === "video" && video!.duration === 90 && video!.posterUrl === "/uploads/p.jpg");
    });

    it("drops HLS output and transcript when the file changed or the block is new", () => {
      const out = preserveManagedVideoFields(stored, [
        { id: "v1", type: "video", src: "/uploads/videos/b.mp4", hlsUrl: "/x.m3u8" },
        { id: "v2", type: "video", src: "/uploads/videos/a.mp4", transcriptId: "tr_1" },
      ]);
      for (const block of out) {
        assert.ok(block.type === "video");
        if (block.type !== "video") continue;
        assert.equal(block.hlsUrl, undefined);
        assert.equal(block.transcriptId, undefined);
        assert.equal(block.storageKey, undefined);
        assert.equal(block.transcode, undefined);
      }
    });
  });
});
