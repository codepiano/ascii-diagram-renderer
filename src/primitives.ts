import type { GlyphGraph } from "./glyph-graph.js";
import { createStableId } from "./identity.js";
import type { Token } from "./tokenizer.js";
import type { PrimitiveArrow, PrimitiveBox, PrimitiveConnector, PrimitiveDocument, PrimitiveText } from "./types.js";

export function extractPrimitives(tokens: Token[], glyphs: GlyphGraph): PrimitiveDocument {
  const texts: PrimitiveText[] = [];
  const boxes: PrimitiveBox[] = [];
  const arrows: PrimitiveArrow[] = [];
  for (const token of tokens) {
    if (token.kind === "text") texts.push({ id: createStableId("text", [token.text, token.bounds.top, token.bounds.left]), kind: "text", text: token.text, bounds: token.bounds });
    if (token.kind === "box") boxes.push({ id: createStableId("box", [token.label, token.bounds.top, token.bounds.left]), kind: "box", label: token.label, bounds: token.bounds });
    if (token.kind === "arrow") arrows.push({ id: createStableId("arrow", [token.direction, token.point.row, token.point.col]), kind: "arrow", direction: token.direction, point: token.point });
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
  const items = [...texts, ...boxes, ...arrows, ...connectors].sort((a, b) => {
    const pointA = a.kind === "arrow" ? a.point : { row: a.bounds.top, col: a.bounds.left };
    const pointB = b.kind === "arrow" ? b.point : { row: b.bounds.top, col: b.bounds.left };
    return pointA.row - pointB.row || pointA.col - pointB.col || a.kind.localeCompare(b.kind);
  });
  return { version: "1", items, texts, boxes, arrows, connectors };
}
