import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  AUDIO_PART_SECONDS,
  apiErrorMessage,
  audioExtractArgs,
  continuityPrompt,
  isMissingEncoderError,
  isPublicMediaUrl,
  languageHint,
  languageTag,
  parseTranscriptionResponse,
  retryAfterMs,
  sortAudioParts,
  transcriptionEndpoint,
} from "@/lib/transcripts/stt";

describe("transcriptionEndpoint", () => {
  it("appends the transcription path to a base URL", () => {
    assert.equal(transcriptionEndpoint("https://api.openai.com/v1"), "https://api.openai.com/v1/audio/transcriptions");
    assert.equal(transcriptionEndpoint(" https://api.groq.com/openai/v1/ "), "https://api.groq.com/openai/v1/audio/transcriptions");
    assert.equal(transcriptionEndpoint("http://localhost:8000"), "http://localhost:8000/audio/transcriptions");
  });

  it("keeps a full endpoint (and its query) as is", () => {
    assert.equal(transcriptionEndpoint("https://x.example/v1/audio/transcriptions/"), "https://x.example/v1/audio/transcriptions");
    assert.equal(transcriptionEndpoint("https://x.example/v1/audio/transcriptions?api-version=2"), "https://x.example/v1/audio/transcriptions?api-version=2");
  });

  it("rejects empty, relative and non-http values", () => {
    assert.equal(transcriptionEndpoint(""), null);
    assert.equal(transcriptionEndpoint("api.openai.com/v1"), null);
    assert.equal(transcriptionEndpoint("ftp://x.example/v1"), null);
  });
});

describe("audio extraction", () => {
  it("writes 16 kHz mono parts of ten minutes", () => {
    const args = audioExtractArgs("/videos/a.mp4", "mp3");
    const at = (flag: string) => args[args.indexOf(flag) + 1];
    assert.equal(at("-i"), "/videos/a.mp4");
    assert.equal(at("-ar"), "16000");
    assert.equal(at("-ac"), "1");
    assert.equal(at("-c:a"), "libmp3lame");
    assert.equal(at("-f"), "segment");
    assert.equal(at("-segment_time"), String(AUDIO_PART_SECONDS));
    assert.equal(at("-map"), "0:a:0");
    assert.equal(args[args.length - 1], "part_%03d.mp3");
    assert.ok(args.includes("-vn"));
  });

  it("falls back to 16-bit WAV and custom part length", () => {
    const args = audioExtractArgs("in.mkv", "wav", 300);
    assert.equal(args[args.indexOf("-c:a") + 1], "pcm_s16le");
    assert.equal(args[args.indexOf("-segment_time") + 1], "300");
    assert.equal(args[args.length - 1], "part_%03d.wav");
  });

  it("keeps ten-minute parts under the 25 MB request limit", () => {
    // 32 kbit/s MP3 and 16 kHz × 16-bit WAV.
    assert.ok((32_000 / 8) * AUDIO_PART_SECONDS < 25 * 1024 * 1024);
    assert.ok(16_000 * 2 * AUDIO_PART_SECONDS < 25 * 1024 * 1024);
  });

  it("detects a missing MP3 encoder", () => {
    assert.ok(isMissingEncoderError("Unknown encoder 'libmp3lame'"));
    assert.ok(isMissingEncoderError("[aost#0:0] Encoder not found"));
    assert.ok(!isMissingEncoderError("Invalid data found when processing input"));
  });

  it("orders part files numerically and ignores others", () => {
    assert.deepEqual(sortAudioParts(["part_010.mp3", "part_002.mp3", "notes.txt", "part_001.wav", "part_000.mp3", "part_1000.mp3"], "mp3"), [
      "part_000.mp3",
      "part_002.mp3",
      "part_010.mp3",
      "part_1000.mp3",
    ]);
  });
});

describe("parseTranscriptionResponse", () => {
  it("reads verbose_json segments, language and top-level words", () => {
    const parsed = parseTranscriptionResponse(
      {
        text: "Hello world. Next part.",
        language: "english",
        segments: [
          { start: 0, end: 1.5, text: " Hello world." },
          { start: 1.5, end: 3, text: " Next part." },
        ],
        words: [
          { start: 0, end: 0.5, word: "Hello" },
          { start: 0.6, end: 1.4, word: "world." },
          { start: 1.6, end: 2, word: "Next" },
          { start: 2.1, end: 2.9, word: "part." },
        ],
      },
      10,
    );
    assert.equal(parsed.language, "en");
    assert.equal(parsed.text, "Hello world. Next part.");
    assert.deepEqual(parsed.segments.map((s) => [s.start, s.end, s.text, s.words?.length]), [
      [0, 1.5, "Hello world.", 2],
      [1.5, 3, "Next part.", 2],
    ]);
  });

  it("drops likely hallucinations on silence and malformed segments", () => {
    const parsed = parseTranscriptionResponse(
      {
        segments: [
          { start: 0, end: 2, text: "Thanks for watching!", no_speech_prob: 0.95, avg_logprob: -1.4 },
          { start: 2, end: 4, text: "Real speech", no_speech_prob: 0.95, avg_logprob: -0.2 },
          { start: "3", end: "5", text: "string times" },
          { start: null, end: 5, text: "no start" },
          { start: 6, end: 7, text: "  " },
          "junk",
        ],
      },
      10,
    );
    assert.deepEqual(parsed.segments.map((s) => s.text), ["Real speech", "string times"]);
    assert.equal(parsed.segments[1]!.start, 3);
  });

  it("falls back to words only, then to text spanning the part", () => {
    const words = parseTranscriptionResponse({ words: [{ start: 1, end: 2, word: "only" }, { start: 2, end: 3, word: "words" }] }, 10);
    assert.deepEqual(words.segments.map((s) => [s.start, s.end, s.text]), [[1, 3, "only words"]]);
    const text = parseTranscriptionResponse({ text: "No timings here" }, 42);
    assert.deepEqual(text.segments, [{ start: 0, end: 42, text: "No timings here" }]);
    assert.deepEqual(parseTranscriptionResponse({ text: "" }, 42).segments, []);
    assert.throws(() => parseTranscriptionResponse(null, 1));
  });
});

describe("languages", () => {
  it("normalizes tags and names", () => {
    assert.equal(languageTag("EN"), "en");
    assert.equal(languageTag("pt_br"), "pt-BR");
    assert.equal(languageTag("zh-Hant-TW"), "zh-Hant-TW");
    assert.equal(languageTag("Hindi"), "hi");
    assert.equal(languageTag("klingon"), null);
    assert.equal(languageTag(" "), null);
  });

  it("sends only the primary subtag as a hint", () => {
    assert.equal(languageHint("pt-BR"), "pt");
    assert.equal(languageHint("EN"), "en");
    assert.equal(languageHint(null), null);
    assert.equal(languageHint("1x"), null);
  });

  it("carries the last words of a part into the next prompt", () => {
    assert.equal(continuityPrompt([{ start: 0, end: 1, text: "short  text" }]), "short text");
    const long = continuityPrompt([{ start: 0, end: 1, text: "alpha ".repeat(100) }], 50);
    assert.ok(long.length <= 50);
    assert.ok(long.startsWith("alpha"));
  });
});

describe("retries and errors", () => {
  it("honours Retry-After seconds and dates, capped at a minute", () => {
    assert.equal(retryAfterMs("3", 0), 3000);
    assert.equal(retryAfterMs("600", 0), 60_000);
    const now = Date.parse("2026-01-01T00:00:00Z");
    assert.equal(retryAfterMs("Thu, 01 Jan 2026 00:00:10 GMT", 0, now), 10_000);
    assert.equal(retryAfterMs("Wed, 31 Dec 2025 00:00:00 GMT", 0, now), 0);
  });

  it("backs off exponentially without a header", () => {
    assert.deepEqual([0, 1, 2, 3, 10].map((a) => retryAfterMs(null, a)), [2000, 4000, 8000, 16000, 30000]);
  });

  it("explains API errors without leaking keys", () => {
    const msg = apiErrorMessage(401, JSON.stringify({ error: { message: "Incorrect API key provided: sk-abcdefghijklmnop1234" } }));
    assert.ok(msg.startsWith("The transcription service rejected the API key."));
    assert.ok(!msg.includes("abcdefghijklmnop"));
    assert.ok(msg.includes("[redacted]"));
    assert.equal(apiErrorMessage(429, ""), "The transcription service is rate limiting requests.");
    assert.equal(apiErrorMessage(413, "<html><b>Too big</b></html>"), "An audio part was too large for the transcription service. Too big");
    assert.equal(apiErrorMessage(502, JSON.stringify({ message: "upstream down" })), "The transcription service answered HTTP 502. upstream down");
  });
});

describe("isPublicMediaUrl", () => {
  it("allows public http(s) hosts", () => {
    assert.ok(isPublicMediaUrl("https://cdn.example.com/v/a.mp4?sig=1"));
    assert.ok(isPublicMediaUrl("http://8.8.8.8/a.mp4"));
    assert.ok(isPublicMediaUrl("https://[2606:4700:4700::1111]/a.mp4"));
  });

  it("blocks private, loopback, internal and odd forms", () => {
    for (const url of [
      "file:///etc/passwd",
      "https://localhost/a.mp4",
      "https://api.localhost/a.mp4",
      "https://intranet/a.mp4",
      "https://media.corp/a.mp4",
      "http://127.0.0.1/a.mp4",
      "http://10.1.2.3/a.mp4",
      "http://172.20.0.1/a.mp4",
      "http://192.168.1.1/a.mp4",
      "http://169.254.169.254/latest/meta-data",
      "http://100.64.0.1/a.mp4",
      "http://0.0.0.0/a.mp4",
      "http://[::1]/a.mp4",
      "http://[fd00::1]/a.mp4",
      "http://[fe80::1]/a.mp4",
      "http://[::ffff:127.0.0.1]/a.mp4",
      "http://2130706433/a.mp4",
      "http://0x7f.1/a.mp4",
      "https://user:pass@cdn.example.com/a.mp4",
      "not a url",
    ]) {
      assert.equal(isPublicMediaUrl(url), false, url);
    }
  });
});
