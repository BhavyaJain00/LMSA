import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  QR_MAX_VERSION,
  QrCapacityError,
  addErrorCorrectionAndInterleave,
  alignmentPatternPositions,
  buildDataCodewords,
  byteCapacity,
  chooseVersion,
  dataCodewords,
  encodeQr,
  encodeQrBytes,
  formatInformationBits,
  gfMultiply,
  maskCondition,
  penaltyScore,
  qrToPath,
  qrToSvg,
  rawDataModules,
  reedSolomonDivisor,
  reedSolomonRemainder,
  utf8Bytes,
  versionInformationBits,
  type QrErrorCorrection,
} from "@/lib/qr";
import { ALIGNMENT_POSITIONS, EC_BLOCKS, VERSION_INFO, decodeQrMatrix, formatWord, gfMul, syndromes } from "../helpers/qr-decoder";

const LEVELS: QrErrorCorrection[] = ["L", "M", "Q", "H"];

/** Byte-mode capacities from ISO/IEC 18004 table 7, versions 1–40. */
const BYTE_CAPACITY: Record<QrErrorCorrection, number[]> = {
  L: [17, 32, 53, 78, 106, 134, 154, 192, 230, 271, 321, 367, 425, 458, 520, 586, 644, 718, 792, 858, 929, 1003, 1091, 1171, 1273, 1367, 1465, 1528, 1628, 1732, 1840, 1952, 2068, 2188, 2303, 2431, 2563, 2699, 2809, 2953],
  M: [14, 26, 42, 62, 84, 106, 122, 152, 180, 213, 251, 287, 331, 362, 412, 450, 504, 560, 624, 666, 711, 779, 857, 911, 997, 1059, 1125, 1190, 1264, 1370, 1452, 1538, 1628, 1722, 1809, 1911, 1989, 2099, 2213, 2331],
  Q: [11, 20, 32, 46, 60, 74, 86, 108, 130, 151, 177, 203, 241, 258, 292, 322, 364, 394, 442, 482, 509, 565, 611, 661, 715, 751, 805, 868, 908, 982, 1030, 1112, 1168, 1228, 1283, 1351, 1423, 1499, 1579, 1663],
  H: [7, 14, 24, 34, 44, 58, 64, 84, 98, 119, 137, 155, 177, 194, 220, 250, 280, 310, 338, 382, 403, 439, 461, 511, 535, 593, 625, 658, 698, 742, 790, 842, 898, 958, 983, 1051, 1093, 1139, 1219, 1273],
};
/** Total codewords per version (ISO/IEC 18004 table 1). */
const TOTAL_CODEWORDS = [
  26, 44, 70, 100, 134, 172, 196, 242, 292, 346, 404, 466, 532, 581, 655, 733, 815, 901, 991, 1085, 1156, 1258, 1364, 1474, 1588, 1706, 1828, 1921, 2051, 2185, 2323, 2465, 2611,
  2761, 2876, 3034, 3196, 3362, 3532, 3706,
];

describe("capacity tables", () => {
  it("matches the total codewords per version", () => {
    TOTAL_CODEWORDS.forEach((total, i) => assert.equal(Math.floor(rawDataModules(i + 1) / 8), total, `version ${i + 1}`));
  });

  it("matches the data codewords and byte capacity of every version and level", () => {
    for (const level of LEVELS) {
      for (let v = 1; v <= QR_MAX_VERSION; v++) {
        const [ec, g1, d1, g2, d2] = EC_BLOCKS[level][v - 1]!;
        assert.equal(dataCodewords(v, level), g1 * d1 + g2 * d2, `${v}-${level} data`);
        assert.equal(g1 * (d1 + ec) + g2 * (d2 + ec), TOTAL_CODEWORDS[v - 1], `${v}-${level} total`);
        assert.equal(byteCapacity(v, level), BYTE_CAPACITY[level][v - 1], `${v}-${level} capacity`);
      }
    }
  });

  it("rejects versions outside 1–40", () => {
    assert.equal(QR_MAX_VERSION, 40);
    for (const bad of [0, 41, 1.5, Number.NaN]) assert.throws(() => rawDataModules(bad), RangeError);
  });

  it("chooses the smallest version that fits", () => {
    assert.equal(chooseVersion(0, "M"), 1);
    assert.equal(chooseVersion(14, "M"), 1);
    assert.equal(chooseVersion(15, "M"), 2);
    assert.equal(chooseVersion(213, "M"), 10);
    assert.equal(chooseVersion(214, "M"), 11);
    assert.equal(chooseVersion(2331, "M"), 40);
    assert.equal(chooseVersion(2332, "M"), null);
    assert.equal(chooseVersion(10, "L", 4), 4);
    assert.equal(chooseVersion(200, "H", 1, 5), null);
  });
});

describe("GF(256) and Reed–Solomon", () => {
  it("multiplies like the log/antilog tables", () => {
    for (let a = 0; a < 256; a += 7) for (let b = 0; b < 256; b += 11) assert.equal(gfMultiply(a, b), gfMul(a, b), `${a}·${b}`);
    assert.equal(gfMultiply(0x53, 1), 0x53);
    assert.equal(gfMultiply(0, 0xff), 0);
  });

  it("reproduces the ISO/IEC 18004 annex I example (\"01234567\", 1-M)", () => {
    const data = [0x10, 0x20, 0x0c, 0x56, 0x61, 0x80, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11];
    const ec = reedSolomonRemainder(data, reedSolomonDivisor(10));
    assert.deepEqual(ec, [0xa5, 0x24, 0xd4, 0xc1, 0xed, 0x36, 0xc7, 0x87, 0x2c, 0x55]);
    assert.ok(syndromes([...data, ...ec], 10).every((s) => s === 0));
  });

  it("produces valid codewords for any data (zero syndromes)", () => {
    for (const degree of [7, 10, 13, 17, 22, 26, 30]) {
      const data = Array.from({ length: 40 }, (_, i) => (i * 97 + degree * 13) & 0xff);
      const ec = reedSolomonRemainder(data, reedSolomonDivisor(degree));
      assert.equal(ec.length, degree);
      assert.ok(syndromes([...data, ...ec], degree).every((s) => s === 0), `degree ${degree}`);
      const corrupted = [...data, ...ec];
      corrupted[3] = corrupted[3]! ^ 0x40;
      assert.ok(syndromes(corrupted, degree).some((s) => s !== 0));
    }
    assert.throws(() => reedSolomonDivisor(0), RangeError);
  });

  it("pads data codewords with the 0xEC/0x11 pattern", () => {
    const words = buildDataCodewords([0x41], 1, "M");
    assert.equal(words.length, 16);
    // 0100 00000001 01000001 0000 → 0x40 0x14 0x10, then pad bytes.
    assert.deepEqual(words.slice(0, 5), [0x40, 0x14, 0x10, 0xec, 0x11]);
    assert.throws(() => buildDataCodewords(new Array<number>(15).fill(0x41), 1, "M"), QrCapacityError);
    assert.throws(() => addErrorCorrectionAndInterleave([1, 2, 3], 1, "M"), RangeError);
  });
});

describe("format, version and alignment information", () => {
  it("encodes the format words from the specification", () => {
    assert.equal(formatInformationBits("M", 0), 0b101010000010010);
    assert.equal(formatInformationBits("L", 0), 0b111011111000100);
    assert.equal(formatInformationBits("Q", 0), 0b011010101011111);
    assert.equal(formatInformationBits("H", 0), 0b001011010001001);
    assert.equal(formatInformationBits("M", 5), 0b100000011001110);
    for (const level of LEVELS) for (let mask = 0; mask < 8; mask++) assert.equal(formatInformationBits(level, mask), formatWord(level, mask));
  });

  it("encodes the version words for versions 7–40", () => {
    assert.equal(Object.keys(VERSION_INFO).length, 34);
    for (const [version, word] of Object.entries(VERSION_INFO)) assert.equal(versionInformationBits(Number(version)), word);
    for (const bad of [6, 41]) assert.throws(() => versionInformationBits(bad), RangeError);
  });

  it("places alignment patterns as in annex E (all 40 versions, including the uneven version 32)", () => {
    assert.equal(ALIGNMENT_POSITIONS.length, 40);
    assert.deepEqual(alignmentPatternPositions(32), [6, 34, 60, 86, 112, 138]);
    ALIGNMENT_POSITIONS.forEach((positions, i) => assert.deepEqual(alignmentPatternPositions(i + 1), positions, `version ${i + 1}`));
  });

  it("uses the eight standard mask patterns", () => {
    assert.equal(maskCondition(0, 1, 1), true);
    assert.equal(maskCondition(1, 5, 2), true);
    assert.equal(maskCondition(2, 3, 1), true);
    assert.equal(maskCondition(4, 3, 2), true);
    assert.equal(maskCondition(4, 2, 2), false);
    assert.throws(() => maskCondition(8, 0, 0), RangeError);
  });
});

describe("encodeQr round trip (independent decoder)", () => {
  const samples = [
    "",
    "A",
    "HELLO WORLD",
    "https://learnloop.example.com/courses/intro-to-python?ref=qr",
    "otpauth://totp/LearnLoop:ada%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=LearnLoop&algorithm=SHA1&digits=6&period=30",
    "Grüße, 世界! 🚀 — ünïcødé",
  ];

  it("decodes back to the original text at every error-correction level", () => {
    for (const level of LEVELS) {
      for (const text of samples) {
        if (utf8Bytes(text).length > byteCapacity(QR_MAX_VERSION, level)) continue;
        const qr = encodeQr(text, { errorCorrection: level });
        assert.equal(qr.size, qr.version * 4 + 17);
        assert.equal(qr.modules.length, qr.size);
        const decoded = decodeQrMatrix(qr.modules);
        assert.equal(decoded.text, text, `${level}: ${text}`);
        assert.equal(decoded.version, qr.version);
        assert.equal(decoded.ecl, level);
        assert.equal(decoded.mask, qr.mask);
      }
    }
  });

  it("works for every version and every mask", () => {
    for (let version = 1; version <= QR_MAX_VERSION; version++) {
      for (let mask = 0; mask < 8; mask++) {
        const text = "x".repeat(byteCapacity(version, "M"));
        const qr = encodeQr(text, { minVersion: version, maxVersion: version, mask });
        const decoded = decodeQrMatrix(qr.modules);
        assert.equal(decoded.version, version);
        assert.equal(decoded.mask, mask);
        assert.equal(decoded.text, text);
      }
    }
  });

  it("picks the mask with the lowest penalty", () => {
    for (const text of samples.slice(1)) {
      const auto = encodeQr(text);
      const penalties = Array.from({ length: 8 }, (_, mask) => penaltyScore(encodeQr(text, { mask, minVersion: auto.version, maxVersion: auto.version }).modules));
      assert.equal(penaltyScore(auto.modules), Math.min(...penalties), text);
    }
  });

  it("uses the smallest version for the payload", () => {
    assert.equal(encodeQr("x".repeat(14)).version, 1);
    assert.equal(encodeQr("x".repeat(15)).version, 2);
    assert.equal(encodeQr("x".repeat(15), { minVersion: 3 }).version, 3);
  });

  it("refuses payloads that do not fit and invalid options", () => {
    assert.throws(() => encodeQr("x".repeat(2332)), QrCapacityError);
    assert.throws(() => encodeQr("x".repeat(214), { maxVersion: 10 }), QrCapacityError);
    assert.throws(() => encodeQr("x".repeat(20), { maxVersion: 1 }), QrCapacityError);
    assert.throws(() => encodeQr("x", { minVersion: 3, maxVersion: 2 }), RangeError);
    assert.throws(() => encodeQr("x", { mask: 8 }), RangeError);
    assert.throws(() => encodeQrBytes([256]), RangeError);
    assert.throws(() => encodeQrBytes([1.5]), RangeError);
  });
});

describe("helpers", () => {
  it("utf8Bytes matches Buffer (lone surrogates become U+FFFD)", () => {
    for (const text of ["", "abc", "é", "€", "𝄞", "日本", "a\ud800b", "\udc00"]) {
      assert.deepEqual(utf8Bytes(text), [...Buffer.from(text, "utf8")], JSON.stringify(text));
    }
  });

  it("penaltyScore punishes uniform matrices", () => {
    const size = 21;
    const dark = Array.from({ length: size }, () => new Array<boolean>(size).fill(true));
    const checker = Array.from({ length: size }, (_, y) => Array.from({ length: size }, (_, x) => (x + y) % 2 === 0));
    assert.ok(penaltyScore(dark) > penaltyScore(checker));
    // A checkerboard has no runs, blocks or finder-like patterns and is 50 % dark.
    assert.equal(penaltyScore(checker), 0);
  });

  it("renders SVG paths covering exactly the dark modules", () => {
    const qr = encodeQr("path test");
    const path = qrToPath(qr);
    const covered = [...path.matchAll(/M\d+ \d+h(\d+)/g)].reduce((sum, m) => sum + Number(m[1]), 0);
    const dark = qr.modules.flat().filter(Boolean).length;
    assert.equal(covered, dark);
    assert.ok(path.startsWith("M4 4h7"), "first run: the top-left finder row, offset by the quiet zone");
  });

  it("renders a standalone, escaped SVG document", () => {
    const qr = encodeQr("svg");
    const svg = qrToSvg(qr, { margin: 2, pixelSize: 128, dark: "#111", light: "#fff", title: 'Scan <me> & "go"' });
    const dim = qr.size + 4;
    assert.ok(svg.startsWith(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}" width="128" height="128"`));
    assert.ok(svg.includes("<title>Scan &lt;me&gt; &amp; &quot;go&quot;</title>"));
    assert.ok(svg.includes(`<rect width="${dim}" height="${dim}" fill="#fff"/>`));
    assert.ok(svg.includes('fill="#111"'));
    assert.ok(svg.endsWith("</svg>"));
    assert.ok(!qrToSvg(qr).includes("width=\"128\""));
  });
});
