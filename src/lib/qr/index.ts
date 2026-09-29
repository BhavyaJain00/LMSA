/**
 * A small, dependency-free QR Code encoder (ISO/IEC 18004).
 *
 * Scope (all that the app needs for authenticator URIs and short links):
 *  - byte mode (UTF-8),
 *  - error correction levels L / M / Q / H (M is the default),
 *  - versions 1–10 (21×21 up to 57×57 modules, up to 213 bytes at level M),
 *  - Reed–Solomon error correction over GF(256) with the 0x11D polynomial,
 *  - block splitting + interleaving,
 *  - all eight mask patterns, picking the one with the lowest penalty score
 *    (rules N1–N4 of the specification),
 *  - BCH-coded format and version information.
 *
 * The module is pure and isomorphic (no Node or DOM APIs), so it can run on
 * the server or in the browser. `qrToSvg` / `qrToPath` turn the matrix into a
 * compact SVG.
 */

export type QrErrorCorrection = "L" | "M" | "Q" | "H";

export interface QrCode {
  /** 1–10 */
  version: number;
  /** Modules per side (4 × version + 17). */
  size: number;
  errorCorrection: QrErrorCorrection;
  /** Mask pattern 0–7 that was applied. */
  mask: number;
  /** `modules[y][x]` is true for a dark module. */
  modules: boolean[][];
}

export interface QrEncodeOptions {
  errorCorrection?: QrErrorCorrection;
  minVersion?: number;
  maxVersion?: number;
  /** Force a specific mask (0–7) instead of choosing the lowest-penalty one. */
  mask?: number;
}

export class QrCapacityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QrCapacityError";
  }
}

export const QR_MIN_VERSION = 1;
export const QR_MAX_VERSION = 10;

/* ------------------------------------------------------------------ */
/* Tables (index 0 unused, versions 1–10)                              */
/* ------------------------------------------------------------------ */

const ECC_CODEWORDS_PER_BLOCK: Record<QrErrorCorrection, readonly number[]> = {
  L: [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18],
  M: [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26],
  Q: [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24],
  H: [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28],
};

const NUM_ERROR_CORRECTION_BLOCKS: Record<QrErrorCorrection, readonly number[]> = {
  L: [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4],
  M: [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5],
  Q: [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8],
  H: [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8],
};

/** Two-bit error correction indicator used in the format information. */
const FORMAT_BITS: Record<QrErrorCorrection, number> = { L: 1, M: 0, Q: 3, H: 2 };

const PENALTY_N1 = 3;
const PENALTY_N2 = 3;
const PENALTY_N3 = 40;
const PENALTY_N4 = 10;

/* ------------------------------------------------------------------ */
/* Capacity helpers                                                     */
/* ------------------------------------------------------------------ */

/** Number of modules available for data + EC codewords (and remainder bits). */
export function rawDataModules(version: number): number {
  assertVersion(version);
  let result = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const numAlign = Math.floor(version / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (version >= 7) result -= 36;
  }
  return result;
}

/** Number of 8-bit data codewords (excluding error correction) for a version and level. */
export function dataCodewords(version: number, ecl: QrErrorCorrection): number {
  return Math.floor(rawDataModules(version) / 8) - ECC_CODEWORDS_PER_BLOCK[ecl][version]! * NUM_ERROR_CORRECTION_BLOCKS[ecl][version]!;
}

/** Bits of the character count indicator in byte mode. */
function byteModeCountBits(version: number): number {
  return version <= 9 ? 8 : 16;
}

/** Maximum payload in bytes for a version and level (byte mode). */
export function byteCapacity(version: number, ecl: QrErrorCorrection): number {
  const bits = dataCodewords(version, ecl) * 8 - 4 - byteModeCountBits(version);
  return Math.max(0, Math.floor(bits / 8));
}

function assertVersion(version: number): void {
  if (!Number.isInteger(version) || version < QR_MIN_VERSION || version > QR_MAX_VERSION) {
    throw new RangeError(`QR version must be an integer between ${QR_MIN_VERSION} and ${QR_MAX_VERSION}.`);
  }
}

/* ------------------------------------------------------------------ */
/* UTF-8                                                                */
/* ------------------------------------------------------------------ */

/** UTF-8 encode without relying on TextEncoder (keeps the module portable). */
export function utf8Bytes(text: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) {
    let cp = text.charCodeAt(i);
    if (cp >= 0xd800 && cp <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        cp = 0x10000 + ((cp - 0xd800) << 10) + (next - 0xdc00);
        i++;
      }
    }
    if (cp >= 0xd800 && cp <= 0xdfff) cp = 0xfffd; // lone surrogate
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Reed–Solomon over GF(2^8), primitive polynomial x^8+x^4+x^3+x^2+1    */
/* ------------------------------------------------------------------ */

/** Multiply two field elements (Russian-peasant multiplication modulo 0x11D). */
export function gfMultiply(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

/**
 * Generator polynomial of the given degree, (x - α^0)(x - α^1)…(x - α^(d-1)),
 * as coefficients from highest to lowest power, leading 1 omitted.
 */
export function reedSolomonDivisor(degree: number): number[] {
  if (degree < 1 || degree > 255) throw new RangeError("Reed–Solomon degree out of range.");
  const result = new Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = gfMultiply(result[j]!, root);
      if (j + 1 < result.length) result[j] = result[j]! ^ result[j + 1]!;
    }
    root = gfMultiply(root, 0x02);
  }
  return result;
}

/** Error correction codewords: remainder of data(x)·x^d divided by the generator. */
export function reedSolomonRemainder(data: readonly number[], divisor: readonly number[]): number[] {
  const result = new Array<number>(divisor.length).fill(0);
  for (const b of data) {
    const factor = b ^ result.shift()!;
    result.push(0);
    for (let i = 0; i < divisor.length; i++) result[i] = result[i]! ^ gfMultiply(divisor[i]!, factor);
  }
  return result;
}

/* ------------------------------------------------------------------ */
/* Bit buffer & data codewords                                         */
/* ------------------------------------------------------------------ */

function appendBits(buffer: number[], value: number, length: number): void {
  for (let i = length - 1; i >= 0; i--) buffer.push((value >>> i) & 1);
}

/** Build the padded data codewords (mode, count, payload, terminator, pad bytes). */
export function buildDataCodewords(bytes: readonly number[], version: number, ecl: QrErrorCorrection): number[] {
  const capacityBits = dataCodewords(version, ecl) * 8;
  const bits: number[] = [];
  appendBits(bits, 0b0100, 4); // byte mode
  appendBits(bits, bytes.length, byteModeCountBits(version));
  for (const b of bytes) appendBits(bits, b, 8);
  if (bits.length > capacityBits) throw new QrCapacityError("Data does not fit in the chosen version.");
  appendBits(bits, 0, Math.min(4, capacityBits - bits.length)); // terminator
  appendBits(bits, 0, (8 - (bits.length % 8)) % 8); // byte align
  for (let pad = 0xec; bits.length < capacityBits; pad ^= 0xec ^ 0x11) appendBits(bits, pad, 8);
  const out: number[] = new Array<number>(bits.length / 8).fill(0);
  bits.forEach((bit, i) => {
    out[i >>> 3] = out[i >>> 3]! | (bit << (7 - (i & 7)));
  });
  return out;
}

/** Split into blocks, add Reed–Solomon codewords and interleave. */
export function addErrorCorrectionAndInterleave(data: readonly number[], version: number, ecl: QrErrorCorrection): number[] {
  if (data.length !== dataCodewords(version, ecl)) throw new RangeError("Invalid data codeword count.");
  const numBlocks = NUM_ERROR_CORRECTION_BLOCKS[ecl][version]!;
  const blockEccLen = ECC_CODEWORDS_PER_BLOCK[ecl][version]!;
  const rawCodewords = Math.floor(rawDataModules(version) / 8);
  const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
  const shortBlockLen = Math.floor(rawCodewords / numBlocks);

  const divisor = reedSolomonDivisor(blockEccLen);
  const blocks: number[][] = [];
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const dat = data.slice(k, k + shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1));
    k += dat.length;
    const ecc = reedSolomonRemainder(dat, divisor);
    if (i < numShortBlocks) dat.push(0); // placeholder so every block has the same length
    blocks.push(dat.concat(ecc));
  }

  const result: number[] = [];
  for (let i = 0; i < blocks[0]!.length; i++) {
    blocks.forEach((block, j) => {
      // Skip the placeholder byte of short blocks.
      if (i !== shortBlockLen - blockEccLen || j >= numShortBlocks) result.push(block[i]!);
    });
  }
  return result;
}

/* ------------------------------------------------------------------ */
/* BCH codes                                                            */
/* ------------------------------------------------------------------ */

/** 15-bit format information (EC level + mask), already XOR-masked with 0x5412. */
export function formatInformationBits(ecl: QrErrorCorrection, mask: number): number {
  const data = (FORMAT_BITS[ecl] << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

/** 18-bit version information (versions 7+). */
export function versionInformationBits(version: number): number {
  let rem = version;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  return (version << 12) | rem;
}

/** Centre coordinates of alignment patterns for a version. */
export function alignmentPatternPositions(version: number): number[] {
  if (version === 1) return [];
  const numAlign = Math.floor(version / 7) + 2;
  const size = version * 4 + 17;
  const step = Math.ceil((version * 4 + 4) / (numAlign * 2 - 2)) * 2;
  const result = [6];
  for (let pos = size - 7; result.length < numAlign; pos -= step) result.splice(1, 0, pos);
  return result;
}

/* ------------------------------------------------------------------ */
/* Matrix construction                                                  */
/* ------------------------------------------------------------------ */

const bit = (value: number, i: number) => ((value >>> i) & 1) !== 0;

class Matrix {
  readonly version: number;
  readonly size: number;
  readonly modules: boolean[][];
  readonly isFunction: boolean[][];

  constructor(version: number) {
    this.version = version;
    this.size = version * 4 + 17;
    this.modules = Array.from({ length: this.size }, () => new Array<boolean>(this.size).fill(false));
    this.isFunction = Array.from({ length: this.size }, () => new Array<boolean>(this.size).fill(false));
  }

  setFunction(x: number, y: number, dark: boolean): void {
    this.modules[y]![x] = dark;
    this.isFunction[y]![x] = true;
  }

  drawFunctionPatterns(): void {
    const { size } = this;
    // Timing patterns
    for (let i = 0; i < size; i++) {
      this.setFunction(6, i, i % 2 === 0);
      this.setFunction(i, 6, i % 2 === 0);
    }
    // Finder patterns (+ separators)
    this.drawFinder(3, 3);
    this.drawFinder(size - 4, 3);
    this.drawFinder(3, size - 4);
    // Alignment patterns (skip the three that would overlap finders)
    const positions = alignmentPatternPositions(this.version);
    const last = positions.length - 1;
    for (let i = 0; i < positions.length; i++) {
      for (let j = 0; j < positions.length; j++) {
        if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) continue;
        this.drawAlignment(positions[i]!, positions[j]!);
      }
    }
    // Reserve format areas with a dummy value; real bits are drawn after masking.
    this.drawFormatBits("M", 0);
    this.drawVersion();
  }

  private drawFinder(x: number, y: number): void {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        const xx = x + dx;
        const yy = y + dy;
        if (xx >= 0 && xx < this.size && yy >= 0 && yy < this.size) this.setFunction(xx, yy, dist !== 2 && dist !== 4);
      }
    }
  }

  private drawAlignment(x: number, y: number): void {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) this.setFunction(x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }

  drawFormatBits(ecl: QrErrorCorrection, mask: number): void {
    const bits = formatInformationBits(ecl, mask);
    const { size } = this;
    // First copy, around the top-left finder
    for (let i = 0; i <= 5; i++) this.setFunction(8, i, bit(bits, i));
    this.setFunction(8, 7, bit(bits, 6));
    this.setFunction(8, 8, bit(bits, 7));
    this.setFunction(7, 8, bit(bits, 8));
    for (let i = 9; i < 15; i++) this.setFunction(14 - i, 8, bit(bits, i));
    // Second copy, split between the top-right and bottom-left finders
    for (let i = 0; i < 8; i++) this.setFunction(size - 1 - i, 8, bit(bits, i));
    for (let i = 8; i < 15; i++) this.setFunction(8, size - 15 + i, bit(bits, i));
    this.setFunction(8, size - 8, true); // the "dark module"
  }

  private drawVersion(): void {
    if (this.version < 7) return;
    const bits = versionInformationBits(this.version);
    for (let i = 0; i < 18; i++) {
      const dark = bit(bits, i);
      const a = this.size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      this.setFunction(a, b, dark);
      this.setFunction(b, a, dark);
    }
  }

  /** Place codewords in the two-column zig-zag, skipping function modules. */
  drawCodewords(codewords: readonly number[]): void {
    const { size } = this;
    let i = 0;
    const totalBits = codewords.length * 8;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5; // skip the vertical timing column
      for (let vert = 0; vert < size; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? size - 1 - vert : vert;
          if (!this.isFunction[y]![x] && i < totalBits) {
            this.modules[y]![x] = bit(codewords[i >>> 3]!, 7 - (i & 7));
            i++;
          }
          // Remaining (remainder) modules stay light, as the spec requires.
        }
      }
    }
  }

  /** XOR the mask pattern onto every non-function module (self-inverse). */
  applyMask(mask: number): void {
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        if (!this.isFunction[y]![x] && maskCondition(mask, x, y)) this.modules[y]![x] = !this.modules[y]![x];
      }
    }
  }
}

export function maskCondition(mask: number, x: number, y: number): boolean {
  switch (mask) {
    case 0:
      return (x + y) % 2 === 0;
    case 1:
      return y % 2 === 0;
    case 2:
      return x % 3 === 0;
    case 3:
      return (x + y) % 3 === 0;
    case 4:
      return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5:
      return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6:
      return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    case 7:
      return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
    default:
      throw new RangeError("Mask must be between 0 and 7.");
  }
}

/* ------------------------------------------------------------------ */
/* Penalty scoring                                                      */
/* ------------------------------------------------------------------ */

const FINDER_LIKE_A = [true, false, true, true, true, false, true, false, false, false, false];
const FINDER_LIKE_B = [false, false, false, false, true, false, true, true, true, false, true];

function lineMatches(line: readonly boolean[], start: number, pattern: readonly boolean[]): boolean {
  for (let k = 0; k < pattern.length; k++) if (line[start + k] !== pattern[k]) return false;
  return true;
}

function linePenalty(line: readonly boolean[]): number {
  let score = 0;
  // N1: runs of five or more modules of the same colour
  let runColor = line[0]!;
  let runLength = 1;
  for (let i = 1; i <= line.length; i++) {
    if (i < line.length && line[i] === runColor) {
      runLength++;
      continue;
    }
    if (runLength >= 5) score += PENALTY_N1 + (runLength - 5);
    if (i < line.length) {
      runColor = line[i]!;
      runLength = 1;
    }
  }
  // N3: 1:1:3:1:1 finder-like pattern with four light modules on one side
  for (let i = 0; i + FINDER_LIKE_A.length <= line.length; i++) {
    if (lineMatches(line, i, FINDER_LIKE_A) || lineMatches(line, i, FINDER_LIKE_B)) score += PENALTY_N3;
  }
  return score;
}

/** Total penalty (N1 + N2 + N3 + N4) of a finished matrix. Lower is better. */
export function penaltyScore(modules: readonly (readonly boolean[])[]): number {
  const size = modules.length;
  let score = 0;
  for (let y = 0; y < size; y++) score += linePenalty(modules[y]!);
  for (let x = 0; x < size; x++) {
    const column: boolean[] = [];
    for (let y = 0; y < size; y++) column.push(modules[y]![x]!);
    score += linePenalty(column);
  }
  // N2: 2×2 blocks of the same colour
  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const c = modules[y]![x];
      if (c === modules[y]![x + 1] && c === modules[y + 1]![x] && c === modules[y + 1]![x + 1]) score += PENALTY_N2;
    }
  }
  // N4: balance of dark and light modules
  let dark = 0;
  for (const row of modules) for (const m of row) if (m) dark++;
  const total = size * size;
  const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
  score += Math.max(0, k) * PENALTY_N4;
  return score;
}

/* ------------------------------------------------------------------ */
/* Public API                                                           */
/* ------------------------------------------------------------------ */

/** Smallest version (within the range) that fits `byteLength` bytes, or null. */
export function chooseVersion(byteLength: number, ecl: QrErrorCorrection, min = QR_MIN_VERSION, max = QR_MAX_VERSION): number | null {
  for (let v = min; v <= max; v++) if (byteLength <= byteCapacity(v, ecl)) return v;
  return null;
}

/** Encode raw bytes as a QR code in byte mode. */
export function encodeQrBytes(bytes: readonly number[], options: QrEncodeOptions = {}): QrCode {
  const ecl = options.errorCorrection ?? "M";
  const minVersion = options.minVersion ?? QR_MIN_VERSION;
  const maxVersion = options.maxVersion ?? QR_MAX_VERSION;
  assertVersion(minVersion);
  assertVersion(maxVersion);
  if (minVersion > maxVersion) throw new RangeError("minVersion must not exceed maxVersion.");
  for (const b of bytes) if (!Number.isInteger(b) || b < 0 || b > 255) throw new RangeError("Bytes must be integers 0–255.");

  const version = chooseVersion(bytes.length, ecl, minVersion, maxVersion);
  if (version === null) {
    throw new QrCapacityError(`Data too long: ${bytes.length} bytes exceeds the ${byteCapacity(maxVersion, ecl)}-byte capacity of version ${maxVersion}-${ecl}.`);
  }

  const codewords = addErrorCorrectionAndInterleave(buildDataCodewords(bytes, version, ecl), version, ecl);
  const matrix = new Matrix(version);
  matrix.drawFunctionPatterns();
  matrix.drawCodewords(codewords);

  let mask = options.mask ?? -1;
  if (mask !== -1 && (!Number.isInteger(mask) || mask < 0 || mask > 7)) throw new RangeError("Mask must be between 0 and 7.");
  if (mask === -1) {
    let best = Infinity;
    for (let m = 0; m < 8; m++) {
      matrix.applyMask(m);
      matrix.drawFormatBits(ecl, m);
      const penalty = penaltyScore(matrix.modules);
      if (penalty < best) {
        best = penalty;
        mask = m;
      }
      matrix.applyMask(m); // undo (XOR)
    }
  }
  matrix.applyMask(mask);
  matrix.drawFormatBits(ecl, mask);

  return { version, size: matrix.size, errorCorrection: ecl, mask, modules: matrix.modules };
}

/** Encode text (UTF-8, byte mode) as a QR code. */
export function encodeQr(text: string, options: QrEncodeOptions = {}): QrCode {
  return encodeQrBytes(utf8Bytes(text), options);
}

/**
 * SVG path data for the dark modules, one sub-path per horizontal run.
 * Coordinates are in modules, offset by `margin`.
 */
export function qrToPath(qr: Pick<QrCode, "modules" | "size">, margin = 4): string {
  const parts: string[] = [];
  for (let y = 0; y < qr.size; y++) {
    const row = qr.modules[y]!;
    let x = 0;
    while (x < qr.size) {
      if (!row[x]) {
        x++;
        continue;
      }
      const start = x;
      while (x < qr.size && row[x]) x++;
      parts.push(`M${start + margin} ${y + margin}h${x - start}v1h-${x - start}z`);
    }
  }
  return parts.join("");
}

export interface QrSvgOptions {
  /** Quiet zone in modules (the spec requires 4). */
  margin?: number;
  /** Rendered width/height in pixels; omit for a fluid SVG (100% width). */
  pixelSize?: number;
  dark?: string;
  light?: string;
  /** Accessible title. */
  title?: string;
}

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);
}

/** Render a QR code as a standalone SVG document string. */
export function qrToSvg(qr: Pick<QrCode, "modules" | "size">, options: QrSvgOptions = {}): string {
  const margin = options.margin ?? 4;
  const dim = qr.size + margin * 2;
  const dark = escapeXml(options.dark ?? "#000000");
  const light = escapeXml(options.light ?? "#ffffff");
  const sizeAttrs = options.pixelSize ? ` width="${options.pixelSize}" height="${options.pixelSize}"` : "";
  const title = options.title ? `<title>${escapeXml(options.title)}</title>` : "";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}"${sizeAttrs} shape-rendering="crispEdges" role="img">` +
    title +
    `<rect width="${dim}" height="${dim}" fill="${light}"/>` +
    `<path d="${qrToPath(qr, margin)}" fill="${dark}"/>` +
    `</svg>`
  );
}
