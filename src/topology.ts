import type { Bounds, Diagram, DiagramEdge, DiagramNode, Point, Token } from "./types.js";

const center = (b: Bounds): Point => ({ row: Math.round((b.top + b.bottom) / 2), col: Math.round((b.left + b.right) / 2) });
const distance = (a: Point, b: Point) => Math.abs(a.row - b.row) + Math.abs(a.col - b.col);
const nodeTokens = (tokens: Token[]) => tokens.filter((t): t is Extract<Token, { kind: "text" | "box" }> => t.kind === "text" || t.kind === "box");

export function recoverTopology(tokens: Token[], source: { lines: string[]; width: number; height: number }): Diagram {
  const nodes: DiagramNode[] = nodeTokens(tokens).map((token, i) => ({ id: `n${i + 1}`, label: token.kind === "box" ? token.label : token.text, shape: token.kind === "box" ? "box" : "text", sourceBounds: token.bounds }));
  const arrows = tokens.filter((t): t is Extract<Token, { kind: "arrow" }> => t.kind === "arrow");
  const edges: DiagramEdge[] = [];
  for (const arrow of arrows) {
    const before = nodes.filter(n => center(n.sourceBounds).row < arrow.point.row || (center(n.sourceBounds).row === arrow.point.row && center(n.sourceBounds).col < arrow.point.col));
    const after = nodes.filter(n => center(n.sourceBounds).row > arrow.point.row || (center(n.sourceBounds).row === arrow.point.row && center(n.sourceBounds).col > arrow.point.col));
    const candidates = arrow.direction === "down" || arrow.direction === "up" ? [before.sort((a,b) => distance(center(b.sourceBounds), arrow.point) - distance(center(a.sourceBounds), arrow.point)).at(-1), after.sort((a,b) => distance(center(a.sourceBounds), arrow.point) - distance(center(b.sourceBounds), arrow.point))[0]] : [before.at(-1), after[0]];
    const sourceNode = arrow.direction === "up" || arrow.direction === "left" ? candidates[1] : candidates[0];
    const targetNode = arrow.direction === "up" || arrow.direction === "left" ? candidates[0] : candidates[1];
    if (sourceNode && targetNode && sourceNode.id !== targetNode.id && !edges.some(e => e.source === sourceNode.id && e.target === targetNode.id)) edges.push({ id: `e${edges.length + 1}`, source: sourceNode.id, target: targetNode.id, direction: arrow.direction, sourcePath: [center(sourceNode.sourceBounds), arrow.point, center(targetNode.sourceBounds)], sourceRoute: "orthogonal", arrow: "normal" });
  }
  const diagnostics = nodes.length === 0
    ? [{ code: "NO_NODES", message: "No supported diagram nodes were found.", severity: "warning" as const }]
    : [];
  if (arrows.length > edges.length) diagnostics.push({ code: "UNRESOLVED_ARROW", message: "One or more arrows could not be connected to two nodes.", severity: "warning" as const });
  return { version: "1" as const, nodes, edges, groups: [], diagnostics, source };
}
