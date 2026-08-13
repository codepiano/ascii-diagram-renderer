import type { Point } from "./types.js";

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
}
