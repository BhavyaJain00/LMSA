/**
 * Hand-written diff for lesson history: a longest-common-subsequence (LCS)
 * diff over any sequence, a line diff built on it, word-level highlights for
 * changed lines and the row model of the side-by-side view.
 *
 * Pure and dependency-free (shared by the server, which computes diffs, and
 * the client, which only renders them).
 */

export type DiffOpType = "equal" | "remove" | "add";

export interface DiffOp<T> {
  type: DiffOpType;
  value: T;
  /** 0-based index in the "before" sequence (equal and remove). */
  a?: number;
  /** 0-based index in the "after" sequence (equal and add). */
  b?: number;
}

export interface SequenceDiff<T> {
  ops: DiffOp<T>[];
  /**
   * The middle part was too large for the LCS table and is reported as "all
   * removed, then all added" (still a correct diff, just not a minimal one).
   */
  coarse: boolean;
}

/** Largest LCS table (rows × columns) built before falling back to a coarse diff. */
export const MAX_LCS_CELLS = 4_000_000;

/**
 * Diff two sequences. Common leading and trailing items are matched first,
 * the rest goes through a classic dynamic-programming LCS table. Removals are
 * listed before additions inside a changed region, so the output is stable.
 */
export function diffSequence<T>(before: readonly T[], after: readonly T[], opts: { equals?: (a: T, b: T) => boolean; maxCells?: number } = {}): SequenceDiff<T> {
  const equals = opts.equals ?? Object.is;
  const maxCells = opts.maxCells ?? MAX_LCS_CELLS;
  const ops: DiffOp<T>[] = [];

  let start = 0;
  const shortest = Math.min(before.length, after.length);
  while (start < shortest && equals(before[start]!, after[start]!)) start++;
  let endA = before.length;
  let endB = after.length;
  while (endA > start && endB > start && equals(before[endA - 1]!, after[endB - 1]!)) {
    endA--;
    endB--;
  }

  for (let i = 0; i < start; i++) ops.push({ type: "equal", value: after[i]!, a: i, b: i });

  const n = endA - start;
  const m = endB - start;
  let coarse = false;
  if (n > 0 && m > 0 && n * m > maxCells) {
    coarse = true;
    for (let i = start; i < endA; i++) ops.push({ type: "remove", value: before[i]!, a: i });
    for (let j = start; j < endB; j++) ops.push({ type: "add", value: after[j]!, b: j });
  } else if (n > 0 || m > 0) {
    // table[i][j] = length of the LCS of before[start+i..endA) and after[start+j..endB).
    const width = m + 1;
    const table = new Uint32Array((n + 1) * width);
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        table[i * width + j] = equals(before[start + i]!, after[start + j]!)
          ? table[(i + 1) * width + j + 1]! + 1
          : Math.max(table[(i + 1) * width + j]!, table[i * width + j + 1]!);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (equals(before[start + i]!, after[start + j]!)) {
        ops.push({ type: "equal", value: after[start + j]!, a: start + i, b: start + j });
        i++;
        j++;
      } else if (table[(i + 1) * width + j]! >= table[i * width + j + 1]!) {
        ops.push({ type: "remove", value: before[start + i]!, a: start + i });
        i++;
      } else {
        ops.push({ type: "add", value: after[start + j]!, b: start + j });
        j++;
      }
    }
    for (; i < n; i++) ops.push({ type: "remove", value: before[start + i]!, a: start + i });
    for (; j < m; j++) ops.push({ type: "add", value: after[start + j]!, b: start + j });
  }

  for (let k = 0; endA + k < before.length; k++) ops.push({ type: "equal", value: after[endB + k]!, a: endA + k, b: endB + k });
  return { ops: normalizeRuns(ops), coarse };
}

/** Inside each changed region, list every removal before the additions. */
function normalizeRuns<T>(ops: DiffOp<T>[]): DiffOp<T>[] {
  const out: DiffOp<T>[] = [];
  let removes: DiffOp<T>[] = [];
  let adds: DiffOp<T>[] = [];
  const flush = () => {
    out.push(...removes, ...adds);
    removes = [];
    adds = [];
  };
  for (const op of ops) {
    if (op.type === "equal") {
      flush();
      out.push(op);
    } else if (op.type === "remove") removes.push(op);
    else adds.push(op);
  }
  flush();
  return out;
}

/** Length of the longest common subsequence of two sequences. */
export function lcsLength<T>(before: readonly T[], after: readonly T[]): number {
  return diffSequence(before, after).ops.reduce((count, op) => count + (op.type === "equal" ? 1 : 0), 0);
}

/* ------------------------------------------------------------------ */
/* Lines                                                               */
/* ------------------------------------------------------------------ */

/**
 * Split text into lines. Windows line endings are normalised, and one final
 * newline does not count as an extra empty line ("a\n" and "a" are equal).
 * Empty text has no lines.
 */
export function splitDiffLines(text: string): string[] {
  if (!text) return [];
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** LCS line diff of two texts. */
export function diffLines(before: string, after: string, opts: { maxCells?: number } = {}): SequenceDiff<string> {
  return diffSequence(splitDiffLines(before), splitDiffLines(after), { maxCells: opts.maxCells });
}

/* ------------------------------------------------------------------ */
/* Words                                                               */
/* ------------------------------------------------------------------ */

export interface DiffSegment {
  text: string;
  changed: boolean;
}

/** Words, runs of white space and single punctuation marks. */
function tokenize(line: string): string[] {
  return line.match(/[\p{L}\p{N}_]+|\s+|[^\p{L}\p{N}_\s]/gu) ?? [];
}

function pushSegment(list: DiffSegment[], text: string, changed: boolean): void {
  const last = list[list.length - 1];
  if (last && last.changed === changed) last.text += text;
  else list.push({ text, changed });
}

/** Lines longer than this are compared as a whole (no word highlights). */
const MAX_WORD_DIFF_CHARS = 4000;
/** Below this share of common words the two lines count as unrelated. */
const MIN_SIMILARITY = 0.3;

/**
 * Word-level comparison of a changed line: the parts only in the old line and
 * the parts only in the new one. Returns null when the lines have too little
 * in common for highlights to help (the whole line then reads as replaced).
 */
export function diffWords(before: string, after: string): { left: DiffSegment[]; right: DiffSegment[] } | null {
  if (before.length > MAX_WORD_DIFF_CHARS || after.length > MAX_WORD_DIFF_CHARS) return null;
  const a = tokenize(before);
  const b = tokenize(after);
  const { ops } = diffSequence(a, b);
  const isWord = (token: string) => token.trim().length > 0;
  const common = ops.filter((op) => op.type === "equal" && isWord(op.value)).length;
  const longest = Math.max(a.filter(isWord).length, b.filter(isWord).length);
  if (longest === 0 || common / longest < MIN_SIMILARITY) return null;

  const left: DiffSegment[] = [];
  const right: DiffSegment[] = [];
  for (const op of ops) {
    if (op.type === "equal") {
      pushSegment(left, op.value, false);
      pushSegment(right, op.value, false);
    } else if (op.type === "remove") pushSegment(left, op.value, true);
    else pushSegment(right, op.value, true);
  }
  return { left, right };
}

/* ------------------------------------------------------------------ */
/* Side-by-side rows                                                   */
/* ------------------------------------------------------------------ */

export interface DiffCell {
  /** 1-based line number on its side. */
  line: number;
  text: string;
  /** Word-level highlights of a changed line (absent: show the whole line). */
  segments?: DiffSegment[];
}

export type DiffRow =
  | { kind: "equal"; left: DiffCell; right: DiffCell }
  | { kind: "change"; left: DiffCell; right: DiffCell }
  | { kind: "remove"; left: DiffCell }
  | { kind: "add"; right: DiffCell }
  /** `count` unchanged lines hidden between two changed regions. */
  | { kind: "skip"; count: number };

export interface TextDiff {
  rows: DiffRow[];
  /** Lines only in the new text (a changed line counts as one added and one removed). */
  added: number;
  removed: number;
  coarse: boolean;
}

/**
 * Pair the operations of a line diff into rows: inside a changed region the
 * first removed line sits next to the first added one ("change"), and so on;
 * what is left over becomes a one-sided row.
 */
export function toDiffRows(ops: readonly DiffOp<string>[]): DiffRow[] {
  const rows: DiffRow[] = [];
  let removes: DiffOp<string>[] = [];
  let adds: DiffOp<string>[] = [];
  const flush = () => {
    const paired = Math.min(removes.length, adds.length);
    for (let i = 0; i < paired; i++) {
      const left: DiffCell = { line: removes[i]!.a! + 1, text: removes[i]!.value };
      const right: DiffCell = { line: adds[i]!.b! + 1, text: adds[i]!.value };
      const words = diffWords(left.text, right.text);
      if (words) {
        left.segments = words.left;
        right.segments = words.right;
      }
      rows.push({ kind: "change", left, right });
    }
    for (let i = paired; i < removes.length; i++) rows.push({ kind: "remove", left: { line: removes[i]!.a! + 1, text: removes[i]!.value } });
    for (let i = paired; i < adds.length; i++) rows.push({ kind: "add", right: { line: adds[i]!.b! + 1, text: adds[i]!.value } });
    removes = [];
    adds = [];
  };
  for (const op of ops) {
    if (op.type === "equal") {
      flush();
      rows.push({ kind: "equal", left: { line: op.a! + 1, text: op.value }, right: { line: op.b! + 1, text: op.value } });
    } else if (op.type === "remove") removes.push(op);
    else adds.push(op);
  }
  flush();
  return rows;
}

/**
 * Keep `context` unchanged rows around every change and replace longer
 * unchanged stretches with one "skip" row.
 */
export function collapseDiffRows(rows: readonly DiffRow[], context = 3): DiffRow[] {
  const keep = new Array<boolean>(rows.length).fill(false);
  rows.forEach((row, i) => {
    if (row.kind === "equal") return;
    for (let k = Math.max(0, i - context); k <= Math.min(rows.length - 1, i + context); k++) keep[k] = true;
  });
  const out: DiffRow[] = [];
  let hidden = 0;
  rows.forEach((row, i) => {
    if (keep[i]) {
      // Hiding a single line saves nothing: show it instead of a "1 line hidden" marker.
      if (hidden === 1) out.push(rows[i - 1]!);
      else if (hidden > 1) out.push({ kind: "skip", count: hidden });
      hidden = 0;
      out.push(row);
    } else hidden++;
  });
  if (hidden === 1) out.push(rows[rows.length - 1]!);
  else if (hidden > 1) out.push({ kind: "skip", count: hidden });
  return out;
}

/** Line diff of two texts as rows for the side-by-side view, with unchanged stretches collapsed. */
export function diffText(before: string, after: string, opts: { context?: number; maxCells?: number } = {}): TextDiff {
  const { ops, coarse } = diffLines(before, after, { maxCells: opts.maxCells });
  let added = 0;
  let removed = 0;
  for (const op of ops) {
    if (op.type === "add") added++;
    else if (op.type === "remove") removed++;
  }
  return { rows: collapseDiffRows(toDiffRows(ops), opts.context ?? 3), added, removed, coarse };
}
