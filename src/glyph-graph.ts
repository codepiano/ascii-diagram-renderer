import { SourceDocument } from "./source.js";
import type { Point } from "./types.js";

export type Port = "north" | "east" | "south" | "west";
export type GlyphCell = { point: Point; char: string; ports: ReadonlySet<Port> };

const opposite: Record<Port, Port> = { north: "south", east: "west", south: "north", west: "east" };
const delta: Record<Port, Point> = {
  north: { row: -1, col: 0 }, east: { row: 0, col: 1 },
  south: { row: 1, col: 0 }, west: { row: 0, col: -1 }
};
const ports = (...values: Port[]) => new Set(values);
const glyphPorts = new Map<string, ReadonlySet<Port>>([
  ["|", ports("north", "south")], ["│", ports("north", "south")], ["║", ports("north", "south")], ["┃", ports("north", "south")],
  ["-", ports("east", "west")], ["─", ports("east", "west")], ["═", ports("east", "west")], ["━", ports("east", "west")],
  ["┌", ports("east", "south")], ["┐", ports("west", "south")], ["└", ports("north", "east")], ["┘", ports("north", "west")],
  ["╭", ports("east", "south")], ["╮", ports("west", "south")], ["╰", ports("north", "east")], ["╯", ports("north", "west")],
  ["├", ports("north", "east", "south")], ["┤", ports("north", "south", "west")],
  ["┬", ports("east", "south", "west")], ["┴", ports("north", "east", "west")],
  ["┼", ports("north", "east", "south", "west")], ["+", ports("north", "east", "south", "west")]
]);

const pointKey = ({ row, col }: Point) => `${row}:${col}`;

/** Connectivity facts for connector glyphs; semantic recognizers do not inspect glyph tables. */
export class GlyphGraph {
  private readonly cellsByPoint = new Map<string, GlyphCell>();

  constructor(readonly source: SourceDocument) {
    for (let row = 0; row < source.height; row++) for (let col = 0; col < source.width; col++) {
      const char = source.char({ row, col });
      const cellPorts = glyphPorts.get(char);
      if (cellPorts) this.cellsByPoint.set(pointKey({ row, col }), { point: { row, col }, char, ports: cellPorts });
    }
  }

  cell(point: Point): GlyphCell | undefined { return this.cellsByPoint.get(pointKey(point)); }
  isConnector(point: Point): boolean { return this.cellsByPoint.has(pointKey(point)); }

  neighbors(point: Point): GlyphCell[] {
    const cell = this.cell(point);
    if (!cell) return [];
    const result: GlyphCell[] = [];
    for (const port of cell.ports) {
      const offset = delta[port];
      const neighbor = this.cell({ row: point.row + offset.row, col: point.col + offset.col });
      if (neighbor?.ports.has(opposite[port])) result.push(neighbor);
    }
    return result;
  }

  cells(): GlyphCell[] { return [...this.cellsByPoint.values()]; }
}
