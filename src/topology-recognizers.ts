import type { RecognitionCandidate } from "./recognition.js";
import type { Bounds, DiagramEdge, DiagramGroup, DiagramNode, EdgePort, Point, PrimitiveConnector, PrimitiveDocument } from "./types.js";

export type TopologyContext = {
  nodes: DiagramNode[];
  primitives: PrimitiveDocument;
  source: { lines: string[]; width: number; height: number };
};

type ProposedEdge = Omit<DiagramEdge, "id" | "provenance">;
export type GroupInterpretation = Omit<DiagramGroup, "id" | "provenance">;
export type EdgeInterpretation = { edges: ProposedEdge[]; excludeNodes?: string[] };
type EdgeCandidate = RecognitionCandidate<EdgeInterpretation>;

const center = (bounds: Bounds): Point => ({
  row: Math.round((bounds.top + bounds.bottom) / 2),
  col: Math.round((bounds.left + bounds.right) / 2)
});
const distance = (a: Point, b: Point) => Math.abs(a.row - b.row) + Math.abs(a.col - b.col);
const componentForPoints = (connectors: PrimitiveConnector[], points: Point[]) => {
  const matches = connectors.map(component => ({
    component,
    overlap: points.filter(point => component.cells.some(cell => cell.point.row === point.row && cell.point.col === point.col)).length
  })).sort((a, b) => b.overlap - a.overlap);
  return matches[0]?.overlap ? matches[0].component : undefined;
};
const adjacentComponents = (connectors: PrimitiveConnector[], point: Point) => connectors.filter(component => component.cells.some(cell => distance(cell.point, point) === 1));
const horizontalRuns = (connector: PrimitiveConnector) => {
  const byRow = new Map<number, number[]>();
  for (const cell of connector.cells.filter(cell => cell.ports.includes("east") || cell.ports.includes("west"))) {
    byRow.set(cell.point.row, [...(byRow.get(cell.point.row) ?? []), cell.point.col]);
  }
  return [...byRow].flatMap(([row, columns]) => {
    const sorted = [...new Set(columns)].sort((a, b) => a - b);
    const runs: Array<{ row: number; left: number; right: number; points: Point[] }> = [];
    let current: number[] = [];
    for (const column of sorted) {
      if (current.length && column > current.at(-1)! + 1) {
        if (current.length >= 2) runs.push({ row, left: current[0], right: current.at(-1)!, points: current.map(col => ({ row, col })) });
        current = [];
      }
      current.push(column);
    }
    if (current.length >= 2) runs.push({ row, left: current[0], right: current.at(-1)!, points: current.map(col => ({ row, col })) });
    return runs;
  });
};

const diagramEdge = (
  edge: Omit<ProposedEdge, "geometry" | "markerEnd"> & { points: Point[]; arrow: boolean; sourcePort?: EdgePort; targetPort?: EdgePort }
): ProposedEdge => ({
  source: edge.source,
  target: edge.target,
  direction: edge.direction,
  geometry: {
    kind: "polyline",
    points: edge.points,
    sourcePort: edge.sourcePort ?? (edge.direction === "right" ? "right" : edge.direction === "left" ? "left" : edge.direction === "up" ? "top" : "bottom"),
    targetPort: edge.targetPort ?? (edge.direction === "right" ? "left" : edge.direction === "left" ? "right" : edge.direction === "up" ? "bottom" : "top")
  },
  markerEnd: edge.arrow ? "arrow" : "none",
  ...(edge.label ? { label: edge.label } : {})
});

export function recognizeCycles(context: TopologyContext): EdgeCandidate[] {
  const { nodes, primitives } = context;
  const arrows = primitives.arrows;
  const candidates: EdgeCandidate[] = [];
  for (const leftArrow of arrows.filter(arrow => arrow.direction === "up")) for (const rightArrow of arrows.filter(arrow => arrow.direction === "down")) {
    if (leftArrow.point.col >= rightArrow.point.col) continue;
    const top = Math.min(leftArrow.point.row, rightArrow.point.row);
    const bottom = Math.max(leftArrow.point.row, rightArrow.point.row);
    const leftNode = nodes.filter(node => center(node.sourceBounds).col <= leftArrow.point.col && center(node.sourceBounds).row >= top && center(node.sourceBounds).row <= bottom).sort((a, b) => distance(center(a.sourceBounds), leftArrow.point) - distance(center(b.sourceBounds), leftArrow.point))[0];
    const rightNode = nodes.filter(node => center(node.sourceBounds).col >= rightArrow.point.col && center(node.sourceBounds).row >= top && center(node.sourceBounds).row <= bottom).sort((a, b) => distance(center(a.sourceBounds), rightArrow.point) - distance(center(b.sourceBounds), rightArrow.point))[0];
    const railLabel = (side: "top" | "bottom") => nodes.filter(node => {
      const nodeCenter = center(node.sourceBounds);
      return nodeCenter.col > leftArrow.point.col && nodeCenter.col < rightArrow.point.col && (side === "top" ? nodeCenter.row < top : nodeCenter.row > bottom);
    }).sort((a, b) => side === "top" ? b.sourceBounds.top - a.sourceBounds.top : a.sourceBounds.top - b.sourceBounds.top)[0];
    const topLabel = railLabel("top"), bottomLabel = railLabel("bottom");
    if (!leftNode || !rightNode || !topLabel || !bottomLabel) continue;
    const railComponents = primitives.connectors.filter(component => component.bounds.left >= leftArrow.point.col && component.bounds.right <= rightArrow.point.col && component.bounds.top >= topLabel.sourceBounds.top && component.bounds.bottom <= bottomLabel.sourceBounds.bottom);
    const evidence = [leftArrow.id, rightArrow.id, ...railComponents.map(component => component.id), `node:${topLabel.id}`, `node:${bottomLabel.id}`];
    candidates.push({
      id: `cycle:${leftArrow.point.row}:${leftArrow.point.col}:${rightArrow.point.col}`,
      recognizer: "cycle", priority: 100, confidence: 0.98, consumes: evidence, evidence,
      value: {
        excludeNodes: [topLabel.id, bottomLabel.id],
        edges: [
          diagramEdge({ source: leftNode.id, target: rightNode.id, direction: "right", points: [center(leftNode.sourceBounds), { row: topLabel.sourceBounds.top, col: leftArrow.point.col }, { row: topLabel.sourceBounds.top, col: rightArrow.point.col }, center(rightNode.sourceBounds)], sourcePort: "top", targetPort: "top", arrow: true, label: { text: topLabel.label, point: center(topLabel.sourceBounds) } }),
          diagramEdge({ source: rightNode.id, target: leftNode.id, direction: "left", points: [center(rightNode.sourceBounds), { row: bottomLabel.sourceBounds.bottom, col: rightArrow.point.col }, { row: bottomLabel.sourceBounds.bottom, col: leftArrow.point.col }, center(leftNode.sourceBounds)], sourcePort: "bottom", targetPort: "bottom", arrow: true, label: { text: bottomLabel.label, point: center(bottomLabel.sourceBounds) } })
        ]
      }
    });
  }
  return candidates;
}

export function recognizeArrowBranches(context: TopologyContext): EdgeCandidate[] {
  const { nodes, primitives } = context;
  const arrows = primitives.arrows;
  const candidates: EdgeCandidate[] = [];
  for (const connector of primitives.connectors) for (const horizontal of horizontalRuns(connector)) {
    const { row, left, right } = horizontal;
    const sourceColumns = [...new Set(connector.cells.filter(cell => cell.point.row === row && cell.ports.includes("north")).map(cell => cell.point.col))].filter(col => col >= left && col <= right);
    const downArrows = arrows.filter(arrow => arrow.direction === "down" && arrow.point.row === row + 1 && arrow.point.col >= left && arrow.point.col <= right);
    const verticalBelow = [...new Set(connector.cells.filter(cell => cell.point.row === row && cell.ports.includes("south")).map(cell => cell.point.col))].filter(col => col >= left && col <= right);
    const above = (col: number) => nodes.filter(node => node.sourceBounds.bottom < row && node.sourceBounds.left <= col && node.sourceBounds.right >= col).sort((a, b) => b.sourceBounds.bottom - a.sourceBounds.bottom)[0];
    const below = (col: number) => nodes.filter(node => node.sourceBounds.top > row && node.sourceBounds.left <= col && node.sourceBounds.right >= col).sort((a, b) => a.sourceBounds.top - b.sourceBounds.top)[0];
    const targetColumns = downArrows.length ? downArrows.map(arrow => arrow.point.col) : verticalBelow;
    const parents = sourceColumns.map(above).filter(Boolean) as DiagramNode[];
    const targets = targetColumns.map(below).filter(Boolean) as DiagramNode[];
    if (!parents.length || !targets.length || !downArrows.length) continue;
    const pairs = parents.length === 1 || targets.length === 1 ? parents.flatMap(parent => targets.map(target => [parent, target] as const)) : parents.map((parent, index) => [parent, targets[index]] as const).filter((pair): pair is readonly [DiagramNode, DiagramNode] => Boolean(pair[1]));
    const trunk = componentForPoints(primitives.connectors, horizontal.points);
    const evidence = [...(trunk ? [trunk.id] : [connector.id]), ...downArrows.map(arrow => arrow.id), ...downArrows.flatMap(arrow => adjacentComponents(primitives.connectors, arrow.point).map(component => component.id))];
    const edges = pairs.map(([parent, target]) => {
      const col = targetColumns[targets.indexOf(target)] ?? sourceColumns[parents.indexOf(parent)];
      const sourceCenter = center(parent.sourceBounds), targetCenter = center(target.sourceBounds);
      return diagramEdge({ source: parent.id, target: target.id, direction: "down", points: [sourceCenter, { row, col: sourceCenter.col }, { row, col }, { row, col: targetCenter.col }, targetCenter], arrow: true });
    });
    candidates.push({ id: `arrow-branch:${row}:${left}`, recognizer: "arrow-branch", priority: 80, confidence: 0.96, consumes: evidence, evidence, value: { edges } });
  }
  return candidates;
}

export function recognizeArrows(context: TopologyContext): EdgeCandidate[] {
  const { nodes, primitives } = context;
  const arrows = primitives.arrows;
  return arrows.flatMap(arrow => {
    const before = nodes.filter(node => center(node.sourceBounds).row < arrow.point.row || (center(node.sourceBounds).row === arrow.point.row && center(node.sourceBounds).col < arrow.point.col));
    const after = nodes.filter(node => center(node.sourceBounds).row > arrow.point.row || (center(node.sourceBounds).row === arrow.point.row && center(node.sourceBounds).col > arrow.point.col));
    const candidates = arrow.direction === "down" || arrow.direction === "up"
      ? [before.sort((a, b) => distance(center(b.sourceBounds), arrow.point) - distance(center(a.sourceBounds), arrow.point)).at(-1), after.sort((a, b) => distance(center(a.sourceBounds), arrow.point) - distance(center(b.sourceBounds), arrow.point))[0]]
      : [before.at(-1), after[0]];
    const source = arrow.direction === "up" || arrow.direction === "left" ? candidates[1] : candidates[0];
    const target = arrow.direction === "up" || arrow.direction === "left" ? candidates[0] : candidates[1];
    if (!source || !target || source.id === target.id) return [];
    const evidence = [arrow.id, ...adjacentComponents(primitives.connectors, arrow.point).map(component => component.id)];
    const sourceCenter = center(source.sourceBounds), targetCenter = center(target.sourceBounds);
    const points = [sourceCenter, arrow.point, arrow.point, targetCenter];
    return [{ id: `arrow:${arrow.point.row}:${arrow.point.col}`, recognizer: "arrow", priority: 60, confidence: 0.9, consumes: evidence, evidence, value: { edges: [diagramEdge({ source: source.id, target: target.id, direction: arrow.direction, points, arrow: true })] } }];
  });
}

export function recognizeLineEdges(context: TopologyContext): EdgeCandidate[] {
  const { nodes, primitives } = context;
  const candidates: EdgeCandidate[] = [];
  for (const component of primitives.connectors) {
    if (component.junctions.length) continue;
    const { bounds } = component;
    const first = component.cells[0];
    const vertical = bounds.bottom > bounds.top || (bounds.bottom === bounds.top && bounds.right === bounds.left && first.ports.includes("north"));
    const horizontal = bounds.right > bounds.left && bounds.bottom === bounds.top;
    if (!vertical && !horizontal) continue;
    let source: DiagramNode | undefined, target: DiagramNode | undefined;
    if (vertical) {
      source = nodes.filter(node => node.sourceBounds.bottom < bounds.top).sort((a, b) => b.sourceBounds.bottom - a.sourceBounds.bottom || Math.abs(center(a.sourceBounds).col - bounds.left) - Math.abs(center(b.sourceBounds).col - bounds.left))[0];
      target = nodes.filter(node => node.sourceBounds.top > bounds.bottom).sort((a, b) => a.sourceBounds.top - b.sourceBounds.top || Math.abs(center(a.sourceBounds).col - bounds.left) - Math.abs(center(b.sourceBounds).col - bounds.left))[0];
    } else {
      source = nodes.filter(node => node.sourceBounds.right < bounds.left && node.sourceBounds.top <= bounds.top && node.sourceBounds.bottom >= bounds.top).sort((a, b) => b.sourceBounds.right - a.sourceBounds.right)[0];
      target = nodes.filter(node => node.sourceBounds.left > bounds.right && node.sourceBounds.top <= bounds.top && node.sourceBounds.bottom >= bounds.top).sort((a, b) => a.sourceBounds.left - b.sourceBounds.left)[0];
    }
    if (!source || !target) continue;
    const recognizer = vertical ? "vertical-line" : "horizontal-line";
    const evidence = [component.id];
    const path = [...component.paths].sort((a, b) => b.points.length - a.points.length)[0];
    const middle = path?.points[Math.floor(path.points.length / 2)] ?? component.cells[Math.floor(component.cells.length / 2)].point;
    const sourceCenter = center(source.sourceBounds), targetCenter = center(target.sourceBounds);
    const points = [sourceCenter, middle, middle, targetCenter];
    candidates.push({ id: `${recognizer}:${bounds.top}:${bounds.left}`, recognizer, priority: 40, confidence: 0.82, consumes: evidence, evidence, value: { edges: [diagramEdge({ source: source.id, target: target.id, direction: vertical ? "down" : "right", points, arrow: false })] } });
  }
  return candidates;
}

export function recognizeLineBranches(context: TopologyContext): EdgeCandidate[] {
  const { nodes, primitives } = context;
  const arrows = primitives.arrows;
  const candidates: EdgeCandidate[] = [];
  for (const connector of primitives.connectors) for (const horizontal of horizontalRuns(connector)) {
    const { row } = horizontal;
    if (arrows.some(arrow => arrow.direction === "down" && arrow.point.row === row + 1)) continue;
    const { left, right } = horizontal;
    const columns = [...new Set(connector.cells.filter(cell => cell.point.row === row && (cell.ports.includes("north") || cell.ports.includes("south"))).map(cell => cell.point.col))].filter(col => col >= left && col <= right);
    const above = (col: number) => nodes.filter(node => node.sourceBounds.bottom < row && node.sourceBounds.left <= col && node.sourceBounds.right >= col).sort((a, b) => b.sourceBounds.bottom - a.sourceBounds.bottom)[0];
    const below = (col: number) => nodes.filter(node => node.sourceBounds.top > row && node.sourceBounds.left <= col && node.sourceBounds.right >= col).sort((a, b) => a.sourceBounds.top - b.sourceBounds.top)[0];
    const parent = columns.map(above).find(Boolean);
    const branches = columns.map(col => ({ col, target: below(col) })).filter(branch => branch.target);
    if (!parent || !branches.length) continue;
    const trunk = componentForPoints(primitives.connectors, horizontal.points);
    const evidence = [trunk?.id ?? connector.id];
    const edges = branches.map(branch => {
      const sourceCenter = center(parent.sourceBounds), targetCenter = center(branch.target!.sourceBounds);
      return diagramEdge({ source: parent.id, target: branch.target!.id, direction: "down", points: [sourceCenter, { row, col: sourceCenter.col }, { row, col: branch.col }, { row, col: targetCenter.col }, targetCenter], arrow: false });
    });
    candidates.push({ id: `line-branch:${row}:${left}`, recognizer: "line-branch", priority: 50, confidence: 0.9, consumes: evidence, evidence, value: { edges } });
  }
  return candidates;
}

export function recognizeExampleGroups(context: TopologyContext): Array<RecognitionCandidate<GroupInterpretation>> {
  const { nodes, primitives, source } = context;
  const candidates: Array<RecognitionCandidate<GroupInterpretation>> = [];
  for (let index = 0; index < nodes.length - 2; index++) {
    const parent = nodes[index], first = nodes[index + 1];
    const gap = source.lines.slice(parent.sourceBounds.bottom + 1, first.sourceBounds.top);
    if (!gap.length || !gap.every(line => line.trim() === "")) continue;
    const members = [first];
    for (let cursor = index + 2; cursor < nodes.length; cursor++) {
      const previous = nodes[cursor - 1], current = nodes[cursor];
      if (current.sourceBounds.top - previous.sourceBounds.bottom !== 1) break;
      if (primitives.arrows.some(arrow => arrow.point.row === current.sourceBounds.top) || primitives.connectors.some(connector => connector.cells.some(cell => cell.point.row === current.sourceBounds.top))) break;
      members.push(current);
    }
    if (members.length < 2) continue;
    const looksLikeProse = members.some(member => member.label.length > 32 || /[.!?。！？]$/.test(member.label));
    const confidence = looksLikeProse ? 0.35 : 0.72;
    const evidence = [`blank:${parent.sourceBounds.bottom + 1}:${first.sourceBounds.top - 1}`, ...members.map(member => `node:${member.id}`)];
    candidates.push({
      id: `examples:${parent.id}`, recognizer: "examples", priority: 30, confidence,
      consumes: members.map(member => `group-member:${member.id}`), evidence,
      value: {
        kind: "examples", label: "Examples", parent: parent.id, members: members.map(member => member.id),
        sourceBounds: { top: members[0].sourceBounds.top, left: Math.min(...members.map(member => member.sourceBounds.left)), bottom: members.at(-1)!.sourceBounds.bottom, right: Math.max(...members.map(member => member.sourceBounds.right)) }
      }
    });
  }
  return candidates;
}
