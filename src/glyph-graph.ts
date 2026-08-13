import { SourceDocument } from "./source.js";
import type { Bounds, Point } from "./types.js";

export type Port = "north" | "east" | "south" | "west";
export type GlyphCell = { point: Point; char: string; ports: ReadonlySet<Port> };
export type GlyphComponent = {
  id: string;
  cells: GlyphCell[];
  endpoints: Point[];
  junctions: Point[];
  bounds: Bounds;
};
export type GlyphPath = { id: string; componentId: string; points: Point[]; closed: boolean };

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
  private readonly componentList: GlyphComponent[];

  constructor(readonly source: SourceDocument) {
    for (let row = 0; row < source.height; row++) for (let col = 0; col < source.width; col++) {
      const char = source.char({ row, col });
      const cellPorts = glyphPorts.get(char);
      if (cellPorts) this.cellsByPoint.set(pointKey({ row, col }), { point: { row, col }, char, ports: new Set(cellPorts) });
    }
    this.addImplicitAsciiJunctionPorts();
    this.componentList = this.buildComponents();
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
  components(): GlyphComponent[] { return this.componentList; }

  paths(component: GlyphComponent): GlyphPath[] {
    const usedEdges = new Set<string>();
    const cellKeys = new Set(component.cells.map(cell => pointKey(cell.point)));
    const neighbors = (point: Point) => this.neighbors(point).filter(cell => cellKeys.has(pointKey(cell.point)));
    const edgeKey = (a: Point, b: Point) => [pointKey(a), pointKey(b)].sort().join("|");
    const paths: GlyphPath[] = [];
    const walk = (start: Point, first: Point) => {
      const points = [start, first];
      usedEdges.add(edgeKey(start, first));
      let previous = start, current = first;
      while (neighbors(current).length === 2) {
        const next = neighbors(current).find(cell => pointKey(cell.point) !== pointKey(previous));
        if (!next || usedEdges.has(edgeKey(current, next.point))) break;
        points.push(next.point);
        usedEdges.add(edgeKey(current, next.point));
        previous = current;
        current = next.point;
      }
      return points;
    };
    const vertices = component.cells.filter(cell => neighbors(cell.point).length !== 2);
    for (const vertex of vertices) {
      const adjacent = neighbors(vertex.point);
      if (!adjacent.length) paths.push({ id: `${component.id}:p${paths.length + 1}`, componentId: component.id, points: [vertex.point], closed: false });
      for (const next of adjacent) {
        if (usedEdges.has(edgeKey(vertex.point, next.point))) continue;
        paths.push({ id: `${component.id}:p${paths.length + 1}`, componentId: component.id, points: walk(vertex.point, next.point), closed: false });
      }
    }
    if (!vertices.length && component.cells.length) {
      const start = component.cells[0].point;
      const next = neighbors(start)[0];
      if (next) {
        const points = walk(start, next.point);
        paths.push({ id: `${component.id}:p1`, componentId: component.id, points, closed: neighbors(points.at(-1)!).some(cell => pointKey(cell.point) === pointKey(start)) });
      }
    }
    return paths;
  }

  private addImplicitAsciiJunctionPorts(): void {
    for (const cell of this.cellsByPoint.values()) {
      const accepted = cell.char === "-" ? new Set<Port>(["north", "south"])
        : cell.char === "|" ? new Set<Port>(["east", "west"])
          : undefined;
      if (!accepted) continue;
      const mutablePorts = cell.ports as Set<Port>;
      for (const port of accepted) {
        const offset = delta[port];
        const neighbor = this.cell({ row: cell.point.row + offset.row, col: cell.point.col + offset.col });
        if (neighbor?.ports.has(opposite[port])) mutablePorts.add(port);
      }
    }
  }

  private buildComponents(): GlyphComponent[] {
    const components: GlyphComponent[] = [];
    const visited = new Set<string>();
    for (const first of this.cellsByPoint.values()) {
      if (visited.has(pointKey(first.point))) continue;
      const cells: GlyphCell[] = [];
      const queue = [first];
      visited.add(pointKey(first.point));
      while (queue.length) {
        const cell = queue.shift()!;
        cells.push(cell);
        for (const neighbor of this.neighbors(cell.point)) {
          const key = pointKey(neighbor.point);
          if (visited.has(key)) continue;
          visited.add(key);
          queue.push(neighbor);
        }
      }
      cells.sort((a, b) => a.point.row - b.point.row || a.point.col - b.point.col);
      const degrees = cells.map(cell => ({ point: cell.point, degree: this.neighbors(cell.point).length }));
      components.push({
        id: `component:${cells[0].point.row}:${cells[0].point.col}`,
        cells,
        endpoints: degrees.filter(item => item.degree <= 1).map(item => item.point),
        junctions: degrees.filter(item => item.degree > 2).map(item => item.point),
        bounds: {
          top: Math.min(...cells.map(cell => cell.point.row)), left: Math.min(...cells.map(cell => cell.point.col)),
          bottom: Math.max(...cells.map(cell => cell.point.row)), right: Math.max(...cells.map(cell => cell.point.col))
        }
      });
    }
    return components;
  }
}
