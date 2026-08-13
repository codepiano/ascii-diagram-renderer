import type { Point } from "./types.js";

const zeroWidth = /[\p{Mark}\u200d\ufe0e\ufe0f]/u;
const pictographic = /\p{Extended_Pictographic}/u;
const regionalIndicatorPair = /[\u{1f1e6}-\u{1f1ff}]{2}/u;
const Segmenter = (Intl as unknown as { Segmenter?: new (locale?: string, options?: { granularity: "grapheme" }) => { segment(value: string): Iterable<{ segment: string }> } }).Segmenter;

export function characterDisplayWidth(character: string): number {
  if (!character || zeroWidth.test(character)) return 0;
  if (pictographic.test(character)) return 2;
  const value = character.codePointAt(0)!;
  return value >= 0x1100 && (
    value <= 0x115f || value === 0x2329 || value === 0x232a ||
    (value >= 0x2e80 && value <= 0xa4cf && value !== 0x303f) ||
    (value >= 0xac00 && value <= 0xd7a3) || (value >= 0xf900 && value <= 0xfaff) ||
    (value >= 0xfe10 && value <= 0xfe19) || (value >= 0xfe30 && value <= 0xfe6f) ||
    (value >= 0xff00 && value <= 0xff60) || (value >= 0xffe0 && value <= 0xffe6) ||
    (value >= 0x20000 && value <= 0x3fffd)
  ) ? 2 : 1;
}

export const displayWidth = (value: string) => {
  const graphemes = Segmenter ? [...new Segmenter(undefined, { granularity: "grapheme" }).segment(value)].map(item => item.segment) : [...value];
  return graphemes.reduce((width, grapheme) => width + (pictographic.test(grapheme) || regionalIndicatorPair.test(grapheme)
    ? 2
    : [...grapheme].reduce((sum, character) => sum + characterDisplayWidth(character), 0)), 0);
};

/** Normalized source text with one coordinate system for scanning and slicing. */
export class SourceDocument {
  readonly lines: string[];
  readonly rows: readonly (readonly string[])[];
  readonly width: number;
  readonly height: number;

  constructor(input: string) {
    this.lines = input.replace(/\r\n?/g, "\n").split("\n");
    while (this.lines.length && this.lines[this.lines.length - 1] === "") this.lines.pop();
    this.rows = this.lines.map(line => [...line]);
    this.width = this.rows.reduce((max, row) => Math.max(max, row.length), 0);
    this.height = this.rows.length;
  }

  char(point: Point): string {
    return this.rows[point.row]?.[point.col] ?? " ";
  }

  slice(row: number, start: number, end?: number): string {
    return (this.rows[row] ?? []).slice(start, end).join("");
  }

  displayColumn(row: number, sourceColumn: number): number {
    return displayWidth((this.rows[row] ?? []).slice(0, sourceColumn).join(""));
  }

  displayPoint(point: Point): Point {
    return { row: point.row, col: this.displayColumn(point.row, point.col) };
  }
}
