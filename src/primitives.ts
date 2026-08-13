import type { GlyphGraph } from "./glyph-graph.js";
import type { CharacterGrid } from "./grid.js";
import { createStableId } from "./identity.js";
import type { Point, PrimitiveArrow, PrimitiveBox, PrimitiveConnector, PrimitiveDocument, TextRun } from "./types.js";

const vertical = new Set(["|", "│", "║", "┃"]);
const horizontal = new Set(["-", "─", "═", "━"]);
const arrows: Record<string, PrimitiveArrow["direction"]> = {
  "^": "up", "↑": "up", "v": "down", "▼": "down", "↓": "down",
  "<": "left", "←": "left", ">": "right", "→": "right", "▶": "right"
};
const boxCorners = new Set(["+", "┌", "┐", "└", "┘", "╭", "╮", "╰", "╯"]);
const connectorCharacters = new Set([
  ...vertical, ...horizontal, ...boxCorners, ...Object.keys(arrows),
  "├", "┤", "┬", "┴", "┼"
]);

/** Extracts the complete serializable source-fact boundary from a character grid. */
export function extractPrimitives(grid: CharacterGrid, glyphs: GlyphGraph): PrimitiveDocument {
  const textRuns: TextRun[] = [];
  const boxes: PrimitiveBox[] = [];
  const primitiveArrows: PrimitiveArrow[] = [];
  const occupiedByBox = new Set<string>();
  const at = (row: number, col: number) => grid.char({ row, col });
  const pointKey = (point: Point) => `${point.row}:${point.col}`;
  const isArrowAt = (row: number, col: number) => {
    const character = at(row, col);
    if (character === ">") return horizontal.has(at(row, col - 1));
    if (character === "<") return horizontal.has(at(row, col + 1));
    if (character !== "v" && character !== "^") return Boolean(arrows[character]);
    return grid.isBlank({ row, col: col - 1 }) && grid.isBlank({ row, col: col + 1 });
  };
  const isConnectorAt = (row: number, col: number) =>
    glyphs.isConnector({ row, col }) || (connectorCharacters.has(at(row, col)) && isArrowAt(row, col));
  const verticalColumnsAt = (row: number) => [...Array(grid.width)].map((_, col) => col).filter(col => vertical.has(at(row, col)));
  const nearbyColumnAnchors = (row: number, left: number, right: number) => {
    const candidates: Array<{ distance: number; columns: number[] }> = [];
    for (let distance = 1; distance <= 3; distance++) {
      for (const candidateRow of [row - distance, row + distance]) {
        const columns = verticalColumnsAt(candidateRow).filter(col => col >= left && col < right);
        if (columns.length >= 2) candidates.push({ distance, columns });
      }
    }
    candidates.sort((a, b) => b.columns.length - a.columns.length || a.distance - b.distance);
    return candidates[0]?.columns ?? [];
  };
  const addText = (text: string, row: number, left: number) => textRuns.push({
    id: createStableId("text", [text, row, left]),
    kind: "text",
    text,
    bounds: { top: row, left, bottom: row, right: left + [...text].length - 1 }
  });

  // Boxes own their complete rectangle so borders and labels are not emitted twice.
  for (let row = 0; row < grid.height; row++) for (let col = 0; col < grid.width; col++) {
    if (!boxCorners.has(at(row, col)) || occupiedByBox.has(pointKey({ row, col }))) continue;
    const right = [...Array(grid.width - col - 1)].map((_, index) => at(row, col + index + 1));
    const closeCol = right.findIndex(character => ["+", "┐", "╮"].includes(character));
    if (closeCol < 1 || !right.slice(0, closeCol).every(character => horizontal.has(character))) continue;
    const below = [...Array(grid.height - row - 1)].map((_, index) => at(row + index + 1, col));
    const closeRow = below.findIndex(character => ["+", "┘", "╯"].includes(character));
    if (closeRow < 1 || !below.slice(0, closeRow).every(character => vertical.has(character))) continue;
    const bottomRight = { row: row + closeRow + 1, col: col + closeCol + 1 };
    if (!["+", "┘", "╯"].includes(at(bottomRight.row, bottomRight.col))) continue;
    const label = [...Array(bottomRight.row - row - 1)]
      .map((_, index) => grid.slice(row + index + 1, col + 1, bottomRight.col).trim())
      .filter(Boolean)
      .join(" ");
    const bounds = { top: row, left: col, bottom: bottomRight.row, right: bottomRight.col };
    boxes.push({ id: createStableId("box", [label, row, col]), kind: "box", label, bounds });
    for (let ownedRow = row; ownedRow <= bottomRight.row; ownedRow++) {
      for (let ownedCol = col; ownedCol <= bottomRight.col; ownedCol++) occupiedByBox.add(`${ownedRow}:${ownedCol}`);
    }
  }

  for (let row = 0; row < grid.height; row++) {
    let col = 0;
    while (col < grid.width) {
      if (occupiedByBox.has(`${row}:${col}`)) { col++; continue; }
      const character = at(row, col);
      if (isArrowAt(row, col)) {
        primitiveArrows.push({
          id: createStableId("arrow", [arrows[character], row, col]),
          kind: "arrow",
          direction: arrows[character],
          point: { row, col }
        });
        col++;
        continue;
      }
      if (!isConnectorAt(row, col) && !grid.isBlank({ row, col })) {
        const start = col;
        while (col < grid.width && !isConnectorAt(row, col)) col++;
        const raw = grid.slice(row, start, col).replace(/\s+$/, "");
        const anchors = nearbyColumnAnchors(row, start, col);
        const splitAtGap = (midpoint: number) => {
          const line = grid.rows[row].join("");
          const gaps = [...line.matchAll(/ {2,}/g)].map(match => ({ start: match.index!, end: match.index! + match[0].length }));
          const nearest = gaps
            .filter(gap => gap.start > start && gap.end < col)
            .sort((a, b) => Math.abs((a.start + a.end) / 2 - midpoint) - Math.abs((b.start + b.end) / 2 - midpoint))[0];
          return nearest ? Math.round((nearest.start + nearest.end) / 2) : Math.floor(midpoint);
        };
        const segments = anchors.length >= 2
          ? [start, ...anchors.slice(1).map((anchor, index) => splitAtGap((anchors[index] + anchor) / 2)), col]
          : null;
        if (segments) {
          for (let index = 0; index < segments.length - 1; index++) {
            const segmentStart = segments[index], segmentEnd = segments[index + 1];
            const segment = grid.slice(row, segmentStart, segmentEnd);
            const text = segment.trim();
            const first = segment.search(/\S/);
            if (text && first >= 0) addText(text, row, segmentStart + first);
          }
        } else {
          for (const match of raw.matchAll(/\S(?:.*?\S)?(?=\s{2,}|$)/g)) {
            const text = match[0].trim();
            const left = start + match.index! + match[0].search(/\S/);
            if (text) addText(text, row, left);
          }
        }
        continue;
      }
      col++;
    }
  }

  const connectors: PrimitiveConnector[] = glyphs.components().filter(component => !boxes.some(box => component.cells.every(cell =>
    cell.point.row >= box.bounds.top && cell.point.row <= box.bounds.bottom && cell.point.col >= box.bounds.left && cell.point.col <= box.bounds.right
  ))).map(component => ({
    id: component.id,
    kind: "connector",
    bounds: component.bounds,
    cells: component.cells.map(cell => ({ point: cell.point, char: cell.char, ports: [...cell.ports] })),
    endpoints: component.endpoints,
    junctions: component.junctions,
    paths: glyphs.paths(component).map(path => ({ id: path.id, points: path.points, closed: path.closed }))
  }));
  const items = [...textRuns, ...boxes, ...primitiveArrows, ...connectors].sort((a, b) => {
    const pointA = a.kind === "arrow" ? a.point : { row: a.bounds.top, col: a.bounds.left };
    const pointB = b.kind === "arrow" ? b.point : { row: b.bounds.top, col: b.bounds.left };
    return pointA.row - pointB.row || pointA.col - pointB.col || a.kind.localeCompare(b.kind);
  });
  return { version: "1", items, textRuns, boxes, arrows: primitiveArrows, connectors };
}
