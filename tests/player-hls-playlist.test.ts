import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_CODECS,
  PlaylistParseError,
  isMasterPlaylist,
  isPlaylist,
  mp4MimeType,
  parseAttributeList,
  parseByteRange,
  parseMasterPlaylist,
  parseMediaPlaylist,
  resolveUri,
  splitCodecs,
  variantLabel,
} from "@/components/player/hls/playlist";

const MASTER_URL = "https://lms.example.com/uploads/videos/l1/b1/hls/v1/master.m3u8?t=abc.def";

const MASTER = `#EXTM3U
#EXT-X-VERSION:7
#EXT-X-INDEPENDENT-SEGMENTS
#EXT-X-STREAM-INF:BANDWIDTH=5500000,AVERAGE-BANDWIDTH=5000000,RESOLUTION=1920x1080,CODECS="avc1.640028,mp4a.40.2",FRAME-RATE=30.000
1080p/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2800000,RESOLUTION=1280x720,CODECS="avc1.64001f, mp4a.40.2"
720p/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=1100000,RESOLUTION=854x480,CODECS="avc1.64001e,mp4a.40.2"
480p/index.m3u8?t=own
`;

const MEDIA_URL = "https://lms.example.com/uploads/videos/l1/b1/hls/v1/720p/index.m3u8?t=abc.def";

const MEDIA = `#EXTM3U
#EXT-X-VERSION:7
#EXT-X-TARGETDURATION:6
#EXT-X-MEDIA-SEQUENCE:0
#EXT-X-PLAYLIST-TYPE:VOD
#EXT-X-INDEPENDENT-SEGMENTS
#EXT-X-MAP:URI="init.mp4"
#EXTINF:6.000000,
seg_00000.m4s
#EXTINF:6.000000,
seg_00001.m4s
#EXTINF:4.500000,
seg_00002.m4s
#EXT-X-ENDLIST
`;

describe("player-hls: attribute lists", () => {
  it("parses quoted values containing commas and unquoted values", () => {
    const attrs = parseAttributeList('BANDWIDTH=800000,CODECS="avc1.4d401f,mp4a.40.2",RESOLUTION=640x360,NAME="Low, mobile"');
    assert.deepEqual(attrs, { BANDWIDTH: "800000", CODECS: "avc1.4d401f,mp4a.40.2", RESOLUTION: "640x360", NAME: "Low, mobile" });
  });

  it("upper-cases keys and tolerates spaces and an unterminated quote", () => {
    assert.deepEqual(parseAttributeList(' bandwidth=1, uri="a.m3u8'), { BANDWIDTH: "1", URI: "a.m3u8" });
  });

  it("parses byte ranges with and without an offset", () => {
    assert.deepEqual(parseByteRange("1000@200", null), { offset: 200, length: 1000 });
    assert.deepEqual(parseByteRange("500", 1200), { offset: 1200, length: 500 });
    assert.equal(parseByteRange("500", null), null);
    assert.equal(parseByteRange("0@0", 0), null);
    assert.equal(parseByteRange("abc", 0), null);
  });
});

describe("player-hls: URI resolution", () => {
  it("resolves relative URIs against the playlist URL", () => {
    assert.equal(resolveUri("720p/index.m3u8", "https://cdn.example.com/a/master.m3u8"), "https://cdn.example.com/a/720p/index.m3u8");
    assert.equal(resolveUri("../seg.m4s", "https://cdn.example.com/a/720p/index.m3u8"), "https://cdn.example.com/a/seg.m4s");
    assert.equal(resolveUri("/root/seg.m4s", "https://cdn.example.com/a/b.m3u8"), "https://cdn.example.com/root/seg.m4s");
  });

  it("preserves the parent's query token on same-origin URIs without their own query", () => {
    assert.equal(resolveUri("720p/index.m3u8", MASTER_URL), "https://lms.example.com/uploads/videos/l1/b1/hls/v1/720p/index.m3u8?t=abc.def");
  });

  it("keeps a child's own query and never leaks tokens to other origins", () => {
    assert.equal(resolveUri("480p/index.m3u8?t=own", MASTER_URL), "https://lms.example.com/uploads/videos/l1/b1/hls/v1/480p/index.m3u8?t=own");
    assert.equal(resolveUri("https://other.example.net/x.m4s", MASTER_URL), "https://other.example.net/x.m4s");
  });

  it("can opt out of query inheritance", () => {
    assert.equal(resolveUri("a.m4s", MASTER_URL, false), "https://lms.example.com/uploads/videos/l1/b1/hls/v1/a.m4s");
  });

  it("rejects a relative base URL", () => {
    assert.throws(() => resolveUri("a.m4s", "/relative/master.m3u8"), PlaylistParseError);
  });
});

describe("player-hls: master playlists", () => {
  it("detects playlist kinds", () => {
    assert.equal(isPlaylist(MASTER), true);
    assert.equal(isPlaylist("<html>"), false);
    assert.equal(isMasterPlaylist(MASTER), true);
    assert.equal(isMasterPlaylist(MEDIA), false);
  });

  it("parses variants with bandwidth, resolution, codecs and frame rate", () => {
    const master = parseMasterPlaylist(MASTER, MASTER_URL);
    assert.equal(master.kind, "master");
    assert.equal(master.independentSegments, true);
    assert.equal(master.variants.length, 3);
    const [hd, sd, low] = master.variants;
    assert.deepEqual(hd, {
      index: 0,
      uri: "https://lms.example.com/uploads/videos/l1/b1/hls/v1/1080p/index.m3u8?t=abc.def",
      bandwidth: 5_500_000,
      averageBandwidth: 5_000_000,
      width: 1920,
      height: 1080,
      codecs: "avc1.640028,mp4a.40.2",
      frameRate: 30,
    });
    assert.equal(sd!.codecs, "avc1.64001f,mp4a.40.2", "whitespace inside CODECS is removed");
    assert.equal(sd!.height, 720);
    assert.equal(low!.uri.endsWith("480p/index.m3u8?t=own"), true);
  });

  it("parses EXT-X-MEDIA audio renditions and the variant's audio group", () => {
    const text = `#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="English",LANGUAGE="en",DEFAULT=YES,AUTOSELECT=YES,URI="audio/en.m3u8"
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="English",URI="subs/en.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=2000000,RESOLUTION=1280x720,CODECS="avc1.64001f,mp4a.40.2",AUDIO="aud"
video/720p.m3u8
`;
    const master = parseMasterPlaylist(text, "https://cdn.example.com/v/master.m3u8");
    assert.equal(master.media.length, 2);
    assert.deepEqual(master.media[0], {
      type: "AUDIO",
      groupId: "aud",
      name: "English",
      language: "en",
      uri: "https://cdn.example.com/v/audio/en.m3u8",
      isDefault: true,
      autoselect: true,
    });
    assert.equal(master.variants[0]!.audioGroup, "aud");
  });

  it("skips variants without a usable BANDWIDTH and ignores stray URIs", () => {
    const text = `#EXTM3U
orphan.m3u8
#EXT-X-STREAM-INF:RESOLUTION=640x360
nobandwidth.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=900000
ok.m3u8
`;
    const master = parseMasterPlaylist(text, "https://cdn.example.com/master.m3u8");
    assert.equal(master.variants.length, 1);
    assert.equal(master.variants[0]!.uri, "https://cdn.example.com/ok.m3u8");
    assert.equal(master.variants[0]!.index, 0);
  });

  it("handles CRLF line endings and a byte-order mark", () => {
    const master = parseMasterPlaylist("﻿" + MASTER.replace(/\n/g, "\r\n"), MASTER_URL);
    assert.equal(master.variants.length, 3);
  });

  it("rejects non-playlists and masters without variants", () => {
    assert.throws(() => parseMasterPlaylist("not a playlist", MASTER_URL), PlaylistParseError);
    assert.throws(() => parseMasterPlaylist("#EXTM3U\n#EXT-X-VERSION:3\n", MASTER_URL), /no playable variants/);
  });
});

describe("player-hls: media playlists", () => {
  it("parses segments, timings, the init segment and end list", () => {
    const pl = parseMediaPlaylist(MEDIA, MEDIA_URL);
    assert.equal(pl.kind, "media");
    assert.equal(pl.version, 7);
    assert.equal(pl.targetDuration, 6);
    assert.equal(pl.playlistType, "VOD");
    assert.equal(pl.endList, true);
    assert.equal(pl.encrypted, false);
    assert.equal(pl.segments.length, 3);
    assert.equal(pl.totalDuration, 16.5);
    assert.deepEqual(
      pl.segments.map((s) => [s.index, s.sequence, s.start, s.duration]),
      [
        [0, 0, 0, 6],
        [1, 1, 6, 6],
        [2, 2, 12, 4.5],
      ],
    );
    const base = "https://lms.example.com/uploads/videos/l1/b1/hls/v1/720p/";
    assert.equal(pl.segments[0]!.uri, `${base}seg_00000.m4s?t=abc.def`);
    assert.deepEqual(pl.segments[2]!.init, { uri: `${base}init.mp4?t=abc.def` });
  });

  it("numbers segments from EXT-X-MEDIA-SEQUENCE and flags discontinuities", () => {
    const text = `#EXTM3U
#EXT-X-TARGETDURATION:4
#EXT-X-MEDIA-SEQUENCE:120
#EXT-X-MAP:URI="init.mp4"
#EXTINF:4,
a.m4s
#EXT-X-DISCONTINUITY
#EXTINF:4,title text
b.m4s
`;
    const pl = parseMediaPlaylist(text, "https://cdn.example.com/p.m3u8");
    assert.deepEqual(
      pl.segments.map((s) => [s.sequence, s.discontinuity]),
      [
        [120, false],
        [121, true],
      ],
    );
    assert.equal(pl.endList, false, "no EXT-X-ENDLIST and no VOD type: still growing");
  });

  it("supports byte-range segments and byte-range init sections", () => {
    const text = `#EXTM3U
#EXT-X-TARGETDURATION:6
#EXT-X-MAP:URI="main.mp4",BYTERANGE="720@0"
#EXTINF:6,
#EXT-X-BYTERANGE:50000@720
main.mp4
#EXTINF:6,
#EXT-X-BYTERANGE:40000
main.mp4
#EXT-X-ENDLIST
`;
    const pl = parseMediaPlaylist(text, "https://cdn.example.com/v/p.m3u8");
    assert.deepEqual(pl.segments[0]!.init, { uri: "https://cdn.example.com/v/main.mp4", byteRange: { offset: 0, length: 720 } });
    assert.deepEqual(pl.segments[0]!.byteRange, { offset: 720, length: 50000 });
    assert.deepEqual(pl.segments[1]!.byteRange, { offset: 50720, length: 40000 }, "continues after the previous range");
  });

  it("applies a later EXT-X-MAP to the following segments only", () => {
    const text = `#EXTM3U
#EXT-X-TARGETDURATION:6
#EXT-X-MAP:URI="init-a.mp4"
#EXTINF:6,
a.m4s
#EXT-X-MAP:URI="init-b.mp4"
#EXTINF:6,
b.m4s
#EXT-X-ENDLIST
`;
    const pl = parseMediaPlaylist(text, "https://cdn.example.com/p.m3u8");
    assert.equal(pl.segments[0]!.init!.uri, "https://cdn.example.com/init-a.mp4");
    assert.equal(pl.segments[1]!.init!.uri, "https://cdn.example.com/init-b.mp4");
  });

  it("detects encryption and derives a missing target duration", () => {
    const text = `#EXTM3U
#EXT-X-KEY:METHOD=AES-128,URI="key.bin"
#EXTINF:5.2,
a.ts
#EXTINF:3,
b.ts
#EXT-X-ENDLIST
`;
    const pl = parseMediaPlaylist(text, "https://cdn.example.com/p.m3u8");
    assert.equal(pl.encrypted, true);
    assert.equal(pl.targetDuration, 6);
    assert.equal(pl.segments[0]!.init, undefined, "MPEG-TS segments have no init section");
  });

  it("treats METHOD=NONE as unencrypted", () => {
    const pl = parseMediaPlaylist("#EXTM3U\n#EXT-X-KEY:METHOD=NONE\n#EXTINF:2,\na.m4s\n", "https://cdn.example.com/p.m3u8");
    assert.equal(pl.encrypted, false);
  });

  it("rejects malformed media playlists", () => {
    const base = "https://cdn.example.com/p.m3u8";
    assert.throws(() => parseMediaPlaylist(MASTER, base), /master playlist/);
    assert.throws(() => parseMediaPlaylist("#EXTM3U\na.m4s\n", base), /missing its #EXTINF/);
    assert.throws(() => parseMediaPlaylist("#EXTM3U\n#EXTINF:abc,\na.m4s\n", base), /Invalid #EXTINF/);
    assert.throws(() => parseMediaPlaylist("#EXTM3U\n#EXT-X-TARGETDURATION:6\n", base), /no segments/);
    assert.throws(() => parseMediaPlaylist("#EXTM3U\n#EXT-X-MAP:BYTERANGE=\"1@0\"\n#EXTINF:2,\na.m4s\n", base), /without a URI/);
    assert.throws(() => parseMediaPlaylist("#EXTM3U\n#EXTINF:2,\n#EXT-X-BYTERANGE:100\na.m4s\n", base), /BYTERANGE/);
  });
});

describe("player-hls: codecs and labels", () => {
  it("splits video and audio codecs", () => {
    assert.deepEqual(splitCodecs("avc1.64001f,mp4a.40.2"), { video: ["avc1.64001f"], audio: ["mp4a.40.2"] });
    assert.deepEqual(splitCodecs("hvc1.1.6.L93.B0,ec-3"), { video: ["hvc1.1.6.L93.B0"], audio: ["ec-3"] });
    assert.deepEqual(splitCodecs("avc1.4d401e"), { video: ["avc1.4d401e"], audio: [] });
  });

  it("assumes H.264 + AAC when CODECS is missing", () => {
    assert.deepEqual(splitCodecs(undefined), splitCodecs(DEFAULT_CODECS));
  });

  it("builds SourceBuffer MIME types", () => {
    assert.equal(mp4MimeType(["avc1.64001f", "mp4a.40.2"]), 'video/mp4; codecs="avc1.64001f,mp4a.40.2"');
  });

  it("labels variants by height, then name, then bitrate", () => {
    assert.equal(variantLabel({ height: 720, bandwidth: 1 }), "720p");
    assert.equal(variantLabel({ name: "Mobile", bandwidth: 1 }), "Mobile");
    assert.equal(variantLabel({ bandwidth: 640_000 }), "640 kbps");
  });
});
