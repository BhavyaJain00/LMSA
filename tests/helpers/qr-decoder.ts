/**
 * An independent QR Code reader for tests (byte mode, versions 1–40).
 *
 * It decodes a module matrix produced by `src/lib/qr` using only the
 * ISO/IEC 18004 tables and formulas written out below (none of the encoder's
 * internals), so a round trip proves the encoder writes codes a real scanner
 * can read: function patterns, format/version information, masking, the
 * codeword placement, block interleaving, Reed–Solomon error correction and
 * the data segment.
 */
type Ecl = "L" | "M" | "Q" | "H";

/** [EC codewords per block, group-1 blocks, group-1 data codewords, group-2 blocks, group-2 data codewords] (ISO/IEC 18004 table 9). */
type BlockSpec = [number, number, number, number, number];

export const EC_BLOCKS: Record<Ecl, BlockSpec[]> = {
  L: [
    [7, 1, 19, 0, 0],
    [10, 1, 34, 0, 0],
    [15, 1, 55, 0, 0],
    [20, 1, 80, 0, 0],
    [26, 1, 108, 0, 0],
    [18, 2, 68, 0, 0],
    [20, 2, 78, 0, 0],
    [24, 2, 97, 0, 0],
    [30, 2, 116, 0, 0],
    [18, 2, 68, 2, 69],
    [20, 4, 81, 0, 0],
    [24, 2, 92, 2, 93],
    [26, 4, 107, 0, 0],
    [30, 3, 115, 1, 116],
    [22, 5, 87, 1, 88],
    [24, 5, 98, 1, 99],
    [28, 1, 107, 5, 108],
    [30, 5, 120, 1, 121],
    [28, 3, 113, 4, 114],
    [28, 3, 107, 5, 108],
    [28, 4, 116, 4, 117],
    [28, 2, 111, 7, 112],
    [30, 4, 121, 5, 122],
    [30, 6, 117, 4, 118],
    [26, 8, 106, 4, 107],
    [28, 10, 114, 2, 115],
    [30, 8, 122, 4, 123],
    [30, 3, 117, 10, 118],
    [30, 7, 116, 7, 117],
    [30, 5, 115, 10, 116],
    [30, 13, 115, 3, 116],
    [30, 17, 115, 0, 0],
    [30, 17, 115, 1, 116],
    [30, 13, 115, 6, 116],
    [30, 12, 121, 7, 122],
    [30, 6, 121, 14, 122],
    [30, 17, 122, 4, 123],
    [30, 4, 122, 18, 123],
    [30, 20, 117, 4, 118],
    [30, 19, 118, 6, 119],
  ],
  M: [
    [10, 1, 16, 0, 0],
    [16, 1, 28, 0, 0],
    [26, 1, 44, 0, 0],
    [18, 2, 32, 0, 0],
    [24, 2, 43, 0, 0],
    [16, 4, 27, 0, 0],
    [18, 4, 31, 0, 0],
    [22, 2, 38, 2, 39],
    [22, 3, 36, 2, 37],
    [26, 4, 43, 1, 44],
    [30, 1, 50, 4, 51],
    [22, 6, 36, 2, 37],
    [22, 8, 37, 1, 38],
    [24, 4, 40, 5, 41],
    [24, 5, 41, 5, 42],
    [28, 7, 45, 3, 46],
    [28, 10, 46, 1, 47],
    [26, 9, 43, 4, 44],
    [26, 3, 44, 11, 45],
    [26, 3, 41, 13, 42],
    [26, 17, 42, 0, 0],
    [28, 17, 46, 0, 0],
    [28, 4, 47, 14, 48],
    [28, 6, 45, 14, 46],
    [28, 8, 47, 13, 48],
    [28, 19, 46, 4, 47],
    [28, 22, 45, 3, 46],
    [28, 3, 45, 23, 46],
    [28, 21, 45, 7, 46],
    [28, 19, 47, 10, 48],
    [28, 2, 46, 29, 47],
    [28, 10, 46, 23, 47],
    [28, 14, 46, 21, 47],
    [28, 14, 46, 23, 47],
    [28, 12, 47, 26, 48],
    [28, 6, 47, 34, 48],
    [28, 29, 46, 14, 47],
    [28, 13, 46, 32, 47],
    [28, 40, 47, 7, 48],
    [28, 18, 47, 31, 48],
  ],
  Q: [
    [13, 1, 13, 0, 0],
    [22, 1, 22, 0, 0],
    [18, 2, 17, 0, 0],
    [26, 2, 24, 0, 0],
    [18, 2, 15, 2, 16],
    [24, 4, 19, 0, 0],
    [18, 2, 14, 4, 15],
    [22, 4, 18, 2, 19],
    [20, 4, 16, 4, 17],
    [24, 6, 19, 2, 20],
    [28, 4, 22, 4, 23],
    [26, 4, 20, 6, 21],
    [24, 8, 20, 4, 21],
    [20, 11, 16, 5, 17],
    [30, 5, 24, 7, 25],
    [24, 15, 19, 2, 20],
    [28, 1, 22, 15, 23],
    [28, 17, 22, 1, 23],
    [26, 17, 21, 4, 22],
    [30, 15, 24, 5, 25],
    [28, 17, 22, 6, 23],
    [30, 7, 24, 16, 25],
    [30, 11, 24, 14, 25],
    [30, 11, 24, 16, 25],
    [30, 7, 24, 22, 25],
    [28, 28, 22, 6, 23],
    [30, 8, 23, 26, 24],
    [30, 4, 24, 31, 25],
    [30, 1, 23, 37, 24],
    [30, 15, 24, 25, 25],
    [30, 42, 24, 1, 25],
    [30, 10, 24, 35, 25],
    [30, 29, 24, 19, 25],
    [30, 44, 24, 7, 25],
    [30, 39, 24, 14, 25],
    [30, 46, 24, 10, 25],
    [30, 49, 24, 10, 25],
    [30, 48, 24, 14, 25],
    [30, 43, 24, 22, 25],
    [30, 34, 24, 34, 25],
  ],
  H: [
    [17, 1, 9, 0, 0],
    [28, 1, 16, 0, 0],
    [22, 2, 13, 0, 0],
    [16, 4, 9, 0, 0],
    [22, 2, 11, 2, 12],
    [28, 4, 15, 0, 0],
    [26, 4, 13, 1, 14],
    [26, 4, 14, 2, 15],
    [24, 4, 12, 4, 13],
    [28, 6, 15, 2, 16],
    [24, 3, 12, 8, 13],
    [28, 7, 14, 4, 15],
    [22, 12, 11, 4, 12],
    [24, 11, 12, 5, 13],
    [24, 11, 12, 7, 13],
    [30, 3, 15, 13, 16],
    [28, 2, 14, 17, 15],
    [28, 2, 14, 19, 15],
    [26, 9, 13, 16, 14],
    [28, 15, 15, 10, 16],
    [30, 19, 16, 6, 17],
    [24, 34, 13, 0, 0],
    [30, 16, 15, 14, 16],
    [30, 30, 16, 2, 17],
    [30, 22, 15, 13, 16],
    [30, 33, 16, 4, 17],
    [30, 12, 15, 28, 16],
    [30, 11, 15, 31, 16],
    [30, 19, 15, 26, 16],
    [30, 23, 15, 25, 16],
    [30, 23, 15, 28, 16],
    [30, 19, 15, 35, 16],
    [30, 11, 15, 46, 16],
    [30, 59, 16, 1, 17],
    [30, 22, 15, 41, 16],
    [30, 2, 15, 64, 16],
    [30, 24, 15, 46, 16],
    [30, 42, 15, 32, 16],
    [30, 10, 15, 67, 16],
    [30, 20, 15, 61, 16],
  ],
};

/** Alignment pattern centre coordinates (ISO/IEC 18004 annex E). */
export const ALIGNMENT_POSITIONS: number[][] = [
  [],
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
  [6, 28, 50],
  [6, 30, 54],
  [6, 32, 58],
  [6, 34, 62],
  [6, 26, 46, 66],
  [6, 26, 48, 70],
  [6, 26, 50, 74],
  [6, 30, 54, 78],
  [6, 30, 56, 82],
  [6, 30, 58, 86],
  [6, 34, 62, 90],
  [6, 28, 50, 72, 94],
  [6, 26, 50, 74, 98],
  [6, 30, 54, 78, 102],
  [6, 28, 54, 80, 106],
  [6, 32, 58, 84, 110],
  [6, 30, 58, 86, 114],
  [6, 34, 62, 90, 118],
  [6, 26, 50, 74, 98, 122],
  [6, 30, 54, 78, 102, 126],
  [6, 26, 52, 78, 104, 130],
  [6, 30, 56, 82, 108, 134],
  [6, 34, 60, 86, 112, 138],
  [6, 30, 58, 86, 114, 142],
  [6, 34, 62, 90, 118, 146],
  [6, 30, 54, 78, 102, 126, 150],
  [6, 24, 50, 76, 102, 128, 154],
  [6, 28, 54, 80, 106, 132, 158],
  [6, 32, 58, 84, 110, 136, 162],
  [6, 26, 54, 82, 110, 138, 166],
  [6, 30, 58, 86, 114, 142, 170],
];

/** 18-bit version information words (annex D, table D.1). */
export const VERSION_INFO: Record<number, number> = {
  7: 0x07c94,
  8: 0x085bc,
  9: 0x09a99,
  10: 0x0a4d3,
  11: 0x0bbf6,
  12: 0x0c762,
  13: 0x0d847,
  14: 0x0e60d,
  15: 0x0f928,
  16: 0x10b78,
  17: 0x1145d,
  18: 0x12a17,
  19: 0x13532,
  20: 0x149a6,
  21: 0x15683,
  22: 0x168c9,
  23: 0x177ec,
  24: 0x18ec4,
  25: 0x191e1,
  26: 0x1afab,
  27: 0x1b08e,
  28: 0x1cc1a,
  29: 0x1d33f,
  30: 0x1ed75,
  31: 0x1f250,
  32: 0x209d5,
  33: 0x216f0,
  34: 0x228ba,
  35: 0x2379f,
  36: 0x24b0b,
  37: 0x2542e,
  38: 0x26a64,
  39: 0x27541,
  40: 0x28c69,
};

const ECL_BITS: Record<Ecl, number> = { L: 1, M: 0, Q: 3, H: 2 };

/* ------------------------------ GF(256) ------------------------------ */

const EXP = new Array<number>(512);
const LOG = new Array<number>(256).fill(0);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]!;
}

export function gfMul(a: number, b: number): number {
  return a === 0 || b === 0 ? 0 : EXP[LOG[a]! + LOG[b]!]!;
}

export function gfPow2(exponent: number): number {
  return EXP[((exponent % 255) + 255) % 255]!;
}

/** Syndromes of a received block (highest-degree coefficient first); all zero for a valid codeword. */
export function syndromes(codeword: readonly number[], ecLength: number): number[] {
  const out: number[] = [];
  for (let k = 0; k < ecLength; k++) {
    const root = gfPow2(k);
    let acc = 0;
    for (const c of codeword) acc = gfMul(acc, root) ^ c;
    out.push(acc);
  }
  return out;
}

/* --------------------------- format / BCH ---------------------------- */

/** BCH(15,5) format word for an EC level and mask, XOR-masked (annex C). */
export function formatWord(ecl: Ecl, mask: number): number {
  const data = (ECL_BITS[ecl] << 3) | mask;
  let rem = data << 10;
  for (let bit = 14; bit >= 10; bit--) if (rem & (1 << bit)) rem ^= 0x537 << (bit - 10);
  return ((data << 10) | rem) ^ 0x5412;
}

function maskAt(mask: number, x: number, y: number): boolean {
  // i = row (y), j = column (x), as written in the standard.
  const i = y;
  const j = x;
  switch (mask) {
    case 0:
      return (i + j) % 2 === 0;
    case 1:
      return i % 2 === 0;
    case 2:
      return j % 3 === 0;
    case 3:
      return (i + j) % 3 === 0;
    case 4:
      return (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0;
    case 5:
      return ((i * j) % 2) + ((i * j) % 3) === 0;
    case 6:
      return (((i * j) % 2) + ((i * j) % 3)) % 2 === 0;
    default:
      return (((i + j) % 2) + ((i * j) % 3)) % 2 === 0;
  }
}

/* ------------------------------ matrix ------------------------------- */

function functionMap(version: number): boolean[][] {
  const size = version * 4 + 17;
  const fn = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const mark = (x: number, y: number) => {
    if (x >= 0 && y >= 0 && x < size && y < size) fn[y]![x] = true;
  };
  // Finders with separators, timing, format areas and the dark module.
  for (let y = 0; y < 9; y++) for (let x = 0; x < 9; x++) mark(x, y);
  for (let y = 0; y < 9; y++) for (let x = size - 8; x < size; x++) mark(x, y);
  for (let y = size - 8; y < size; y++) for (let x = 0; x < 9; x++) mark(x, y);
  for (let i = 0; i < size; i++) {
    mark(6, i);
    mark(i, 6);
  }
  const positions = ALIGNMENT_POSITIONS[version - 1]!;
  const last = positions.length - 1;
  positions.forEach((cy, a) =>
    positions.forEach((cx, b) => {
      if ((a === 0 && b === 0) || (a === 0 && b === last) || (a === last && b === 0)) return;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) mark(cx + dx, cy + dy);
    }),
  );
  if (version >= 7) {
    for (let i = 0; i < 6; i++) {
      for (let j = size - 11; j < size - 8; j++) {
        mark(j, i);
        mark(i, j);
      }
    }
  }
  return fn;
}

export interface DecodedQr {
  version: number;
  ecl: Ecl;
  mask: number;
  bytes: number[];
  text: string;
}

/** Decode a square module matrix (`modules[y][x]`, true = dark). Throws on any structural error. */
export function decodeQrMatrix(modules: readonly (readonly boolean[])[]): DecodedQr {
  const size = modules.length;
  const version = (size - 17) / 4;
  if (!Number.isInteger(version) || version < 1 || version > 40) throw new Error(`Unsupported size ${size}.`);
  const at = (x: number, y: number) => modules[y]![x] === true;

  // Finder patterns: 7×7 rings (dark border, light ring, dark 3×3 core) with light separators.
  for (const [ox, oy] of [
    [0, 0],
    [size - 7, 0],
    [0, size - 7],
  ] as const) {
    for (let dy = -1; dy <= 7; dy++) {
      for (let dx = -1; dx <= 7; dx++) {
        const x = ox + dx;
        const y = oy + dy;
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        const ring = Math.max(Math.abs(dx - 3), Math.abs(dy - 3));
        const expected = ring !== 2 && ring !== 4;
        if (at(x, y) !== expected) throw new Error(`Finder pattern broken at (${x}, ${y}).`);
      }
    }
  }
  for (let i = 8; i < size - 8; i++) {
    if (at(i, 6) !== (i % 2 === 0) || at(6, i) !== (i % 2 === 0)) throw new Error(`Timing pattern broken at ${i}.`);
  }
  if (!at(8, size - 8)) throw new Error("Dark module missing.");

  // Format information (both copies must agree and be a valid BCH word).
  let first = 0;
  let second = 0;
  const firstPositions: [number, number][] = [
    [8, 0],
    [8, 1],
    [8, 2],
    [8, 3],
    [8, 4],
    [8, 5],
    [8, 7],
    [8, 8],
    [7, 8],
    [5, 8],
    [4, 8],
    [3, 8],
    [2, 8],
    [1, 8],
    [0, 8],
  ];
  firstPositions.forEach(([x, y], i) => {
    if (at(x, y)) first |= 1 << i;
  });
  for (let i = 0; i < 8; i++) if (at(size - 1 - i, 8)) second |= 1 << i;
  for (let i = 8; i < 15; i++) if (at(8, size - 15 + i)) second |= 1 << i;
  if (first !== second) throw new Error("Format information copies differ.");
  let ecl: Ecl | null = null;
  let mask = -1;
  for (const level of ["L", "M", "Q", "H"] as const) {
    for (let m = 0; m < 8; m++) {
      if (formatWord(level, m) === first) {
        ecl = level;
        mask = m;
      }
    }
  }
  if (!ecl) throw new Error(`Invalid format information ${first.toString(2)}.`);

  if (version >= 7) {
    let a = 0;
    let b = 0;
    for (let i = 0; i < 18; i++) {
      const p = size - 11 + (i % 3);
      const q = Math.floor(i / 3);
      if (at(p, q)) a |= 1 << i;
      if (at(q, p)) b |= 1 << i;
    }
    if (a !== VERSION_INFO[version] || b !== VERSION_INFO[version]) throw new Error("Version information broken.");
  }

  // Read the codeword bits in the two-column zig-zag, unmasking as we go.
  const fn = functionMap(version);
  const bits: number[] = [];
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let n = 0; n < size; n++) {
      const y = upward ? size - 1 - n : n;
      for (const x of [right, right - 1]) {
        if (fn[y]![x]) continue;
        bits.push(at(x, y) !== maskAt(mask, x, y) ? 1 : 0);
      }
    }
    upward = !upward;
  }

  const [ecLen, g1, d1, g2, d2] = EC_BLOCKS[ecl][version - 1]!;
  const dataLengths = [...new Array<number>(g1).fill(d1), ...new Array<number>(g2).fill(d2)];
  const total = dataLengths.reduce((sum, d) => sum + d + ecLen, 0);
  if (bits.length < total * 8) throw new Error("Not enough modules for the codewords.");
  const codewords: number[] = [];
  for (let i = 0; i < total; i++) {
    let byte = 0;
    for (let b = 0; b < 8; b++) byte = (byte << 1) | bits[i * 8 + b]!;
    codewords.push(byte);
  }

  // De-interleave the blocks and check every Reed–Solomon codeword.
  const blocks = dataLengths.map((length) => ({ data: [] as number[], ec: [] as number[], length }));
  let k = 0;
  const maxData = Math.max(...dataLengths);
  for (let i = 0; i < maxData; i++) for (const block of blocks) if (i < block.length) block.data.push(codewords[k++]!);
  for (let i = 0; i < ecLen; i++) for (const block of blocks) block.ec.push(codewords[k++]!);
  blocks.forEach((block, index) => {
    if (syndromes([...block.data, ...block.ec], ecLen).some((s) => s !== 0)) throw new Error(`Reed–Solomon check failed for block ${index}.`);
  });

  // Parse the single byte-mode segment, then the terminator and pad bytes.
  const data = blocks.flatMap((b) => b.data);
  const stream = data.flatMap((byte) => Array.from({ length: 8 }, (_, i) => (byte >> (7 - i)) & 1));
  let pos = 0;
  const read = (n: number) => {
    let v = 0;
    for (let i = 0; i < n; i++) v = (v << 1) | (stream[pos++] ?? 0);
    return v;
  };
  if (read(4) !== 0b0100) throw new Error("Not a byte-mode segment.");
  const count = read(version <= 9 ? 8 : 16);
  const bytes: number[] = [];
  for (let i = 0; i < count; i++) bytes.push(read(8));
  if (pos > stream.length) throw new Error("Segment longer than the data.");
  const terminator = Math.min(4, stream.length - pos);
  if (read(terminator) !== 0) throw new Error("Missing terminator.");
  while (pos % 8 !== 0) if (read(1) !== 0) throw new Error("Non-zero padding bit.");
  for (let pad = 0; pos < stream.length; pad++) {
    if (read(8) !== (pad % 2 === 0 ? 0xec : 0x11)) throw new Error("Unexpected pad byte.");
  }
  return { version, ecl, mask, bytes, text: Buffer.from(bytes).toString("utf8") };
}
