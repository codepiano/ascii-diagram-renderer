import type { Bounds, Point } from "./types.js";

export class CharacterGrid {
  readonly lines: string[];
  readonly width: number;
  readonly height: number;

  constructor(input: string) {
    this.lines = input.replace(/\r\n?/g, "\n").split("\n");
    while (this.lines.length && this.lines[this.lines.length - 1] === "") this.lines.pop();
    this.width = this.lines.reduce((max, line) => Math.max(max, [...line].length), 0);
    this.height = this.lines.length;
  }

  char(point: Point): string {
    return [...(this.lines[point.row] ?? "")][point.col] ?? " ";
  }

  isBlank(point: Point): boolean { return this.char(point).trim() === ""; }

  bounds(points: Point[]): Bounds {
    return {
      top: Math.min(...points.map(p => p.row)), left: Math.min(...points.map(p => p.col)),
      bottom: Math.max(...points.map(p => p.row)), right: Math.max(...points.map(p => p.col))
    };
  }
}
