import type { CanonicalEdge, CanonicalGroup } from "./canonical.js";
import type { GlyphGraph } from "./glyph-graph.js";
import type { RecognitionCandidate } from "./recognition.js";
import type { Bounds, DiagramNode, Point, Token } from "./types.js";

export type TopologyContext = {
  nodes: DiagramNode[];
  tokens: Token[];
  source: { lines: string[]; width: number; height: number };
  glyphs: GlyphGraph;
};

type ProposedEdge = Omit<CanonicalEdge, "provenance">;
type ProposedGroup = Omit<CanonicalGroup, "provenance">;
export type EdgeInterpretation = { edges: ProposedEdge[]; excludeNodes?: string[] };
type EdgeCandidate = RecognitionCandidate<EdgeInterpretation>;

const center = (bounds: Bounds): Point => ({
  row: Math.round((bounds.top + bounds.bottom) / 2),
  col: Math.round((bounds.left + bounds.right) / 2)
});
const distance = (a: Point, b: Point) => Math.abs(a.row - b.row) + Math.abs(a.col - b.col);
const evidenceKey = (tokens: Token[], token: Token) => `token:${tokens.indexOf(token)}`;

const canonicalEdge = (
  edge: Omit<ProposedEdge, "geometry" | "markerEnd"> & { points: Point[]; arrow: boolean }
): ProposedEdge => ({
  source: edge.source,
  target: edge.target,
  direction: edge.direction,
  geometry: { kind: "polyline", points: edge.points },
  markerEnd: edge.arrow ? "arrow" : "none",
  ...(edge.label ? { label: edge.label } : {})
});

export function normalizeMultilineNodes(nodes: DiagramNode[], tokens: Token[]): DiagramNode[] {
  const verticals = tokens.filter((token): token is Extract<Token, { kind: "line" }> => token.kind === "line" && token.orientation === "vertical");
  const consumed = new Set<string>();
  const replacements = new Map<string, DiagramNode>();
  for (const parent of nodes) {
    if (parent.shape !== "text") continue;
    const parentCenter = center(parent.sourceBounds);
    const outgoing = verticals.filter(line => line.points.some(point => point.row === parent.sourceBounds.bottom + 1)).sort((a, b) => Math.abs(a.points[0].col - parentCenter.col) - Math.abs(b.points[0].col - parentCenter.col))[0];
    if (!outgoing) continue;
    const axis = outgoing.points[0].col;
    const startRow = parent.sourceBounds.bottom + 2;
    const closing = verticals.flatMap(line => line.points.filter(point => point.col === axis && point.row >= startRow)).sort((a, b) => a.row - b.row)[0];
    if (!closing || closing.row === startRow) continue;
    const descriptions = nodes.filter(candidate => candidate.id !== parent.id && !consumed.has(candidate.id) && candidate.shape === "text" && candidate.sourceBounds.top >= startRow && candidate.sourceBounds.bottom < closing.row).filter(candidate => {
      const candidateCenter = center(candidate.sourceBounds);
      return nodes.filter(other => other.id !== parent.id && other.sourceBounds.top === parent.sourceBounds.top).every(other => Math.abs(candidateCenter.col - axis) <= Math.abs(candidateCenter.col - center(other.sourceBounds).col));
    }).sort((a, b) => a.sourceBounds.top - b.sourceBounds.top || a.sourceBounds.left - b.sourceBounds.left);
    if (descriptions.length < 2) continue;
    const [body, ...continuations] = descriptions;
    continuations.forEach(description => consumed.add(description.id));
    replacements.set(body.id, {
      ...body,
      label: descriptions.map(description => description.label).join("\n"),
      sourceBounds: {
        top: body.sourceBounds.top,
        left: Math.min(...descriptions.map(description => description.sourceBounds.left)),
        bottom: Math.max(...descriptions.map(description => description.sourceBounds.bottom)),
        right: Math.max(...descriptions.map(description => description.sourceBounds.right))
      }
    });
  }
  return nodes.filter(node => !consumed.has(node.id)).map(node => replacements.get(node.id) ?? node);
}

export function recognizeCycles(context: TopologyContext): EdgeCandidate[] {
  const { nodes, tokens } = context;
  const arrows = tokens.filter((token): token is Extract<Token, { kind: "arrow" }> => token.kind === "arrow");
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
    const evidence = [evidenceKey(tokens, leftArrow), evidenceKey(tokens, rightArrow), `node:${topLabel.id}`, `node:${bottomLabel.id}`];
    candidates.push({
      id: `cycle:${leftArrow.point.row}:${leftArrow.point.col}:${rightArrow.point.col}`,
      recognizer: "cycle", priority: 100, confidence: 0.98, consumes: evidence, evidence,
      value: {
        excludeNodes: [topLabel.id, bottomLabel.id],
        edges: [
          canonicalEdge({ source: leftNode.id, target: rightNode.id, direction: "right", points: [center(leftNode.sourceBounds), { row: topLabel.sourceBounds.top, col: leftArrow.point.col }, { row: topLabel.sourceBounds.top, col: rightArrow.point.col }, center(rightNode.sourceBounds)], arrow: true, label: { text: topLabel.label, point: center(topLabel.sourceBounds) } }),
          canonicalEdge({ source: rightNode.id, target: leftNode.id, direction: "left", points: [center(rightNode.sourceBounds), { row: bottomLabel.sourceBounds.bottom, col: rightArrow.point.col }, { row: bottomLabel.sourceBounds.bottom, col: leftArrow.point.col }, center(leftNode.sourceBounds)], arrow: true, label: { text: bottomLabel.label, point: center(bottomLabel.sourceBounds) } })
        ]
      }
    });
  }
  return candidates;
}

export function recognizeArrowBranches(context: TopologyContext): EdgeCandidate[] {
  const { nodes, tokens, glyphs } = context;
  const arrows = tokens.filter((token): token is Extract<Token, { kind: "arrow" }> => token.kind === "arrow");
  const lines = tokens.filter((token): token is Extract<Token, { kind: "line" }> => token.kind === "line");
  const candidates: EdgeCandidate[] = [];
  for (const horizontal of lines.filter(line => line.orientation === "horizontal")) {
    const row = horizontal.points[0].row, left = horizontal.points[0].col, right = horizontal.points.at(-1)!.col;
    const graphColumns = horizontal.points.filter(point => glyphs.cell(point)?.ports.has("north")).map(point => point.col);
    const sourceColumns = [...new Set([...graphColumns, ...lines.filter(line => line.orientation === "vertical").flatMap(line => line.points.filter(point => point.row === row - 1).map(point => point.col))])].filter(col => col >= left && col <= right);
    const downArrows = arrows.filter(arrow => arrow.direction === "down" && arrow.point.row === row + 1 && arrow.point.col >= left && arrow.point.col <= right);
    const verticalBelow = [...new Set(lines.filter(line => line.orientation === "vertical").flatMap(line => line.points.filter(point => point.row === row + 1).map(point => point.col)))].filter(col => col >= left && col <= right);
    const above = (col: number) => nodes.filter(node => node.sourceBounds.bottom < row && node.sourceBounds.left <= col && node.sourceBounds.right >= col).sort((a, b) => b.sourceBounds.bottom - a.sourceBounds.bottom)[0];
    const below = (col: number) => nodes.filter(node => node.sourceBounds.top > row && node.sourceBounds.left <= col && node.sourceBounds.right >= col).sort((a, b) => a.sourceBounds.top - b.sourceBounds.top)[0];
    const targetColumns = downArrows.length ? downArrows.map(arrow => arrow.point.col) : verticalBelow;
    const parents = sourceColumns.map(above).filter(Boolean) as DiagramNode[];
    const targets = targetColumns.map(below).filter(Boolean) as DiagramNode[];
    if (!parents.length || !targets.length || !downArrows.length) continue;
    const pairs = parents.length === 1 || targets.length === 1 ? parents.flatMap(parent => targets.map(target => [parent, target] as const)) : parents.map((parent, index) => [parent, targets[index]] as const).filter((pair): pair is readonly [DiagramNode, DiagramNode] => Boolean(pair[1]));
    const evidence = [evidenceKey(tokens, horizontal), ...downArrows.map(arrow => evidenceKey(tokens, arrow))];
    const edges = pairs.map(([parent, target]) => {
      const col = targetColumns[targets.indexOf(target)] ?? sourceColumns[parents.indexOf(parent)];
      return canonicalEdge({ source: parent.id, target: target.id, direction: "down", points: [center(parent.sourceBounds), { row, col }, center(target.sourceBounds)], arrow: true });
    });
    candidates.push({ id: `arrow-branch:${row}:${left}`, recognizer: "arrow-branch", priority: 80, confidence: 0.96, consumes: evidence, evidence, value: { edges } });
  }
  return candidates;
}

export function recognizeArrows(context: TopologyContext): EdgeCandidate[] {
  const { nodes, tokens } = context;
  const arrows = tokens.filter((token): token is Extract<Token, { kind: "arrow" }> => token.kind === "arrow");
  return arrows.flatMap(arrow => {
    const before = nodes.filter(node => center(node.sourceBounds).row < arrow.point.row || (center(node.sourceBounds).row === arrow.point.row && center(node.sourceBounds).col < arrow.point.col));
    const after = nodes.filter(node => center(node.sourceBounds).row > arrow.point.row || (center(node.sourceBounds).row === arrow.point.row && center(node.sourceBounds).col > arrow.point.col));
    const candidates = arrow.direction === "down" || arrow.direction === "up"
      ? [before.sort((a, b) => distance(center(b.sourceBounds), arrow.point) - distance(center(a.sourceBounds), arrow.point)).at(-1), after.sort((a, b) => distance(center(a.sourceBounds), arrow.point) - distance(center(b.sourceBounds), arrow.point))[0]]
      : [before.at(-1), after[0]];
    const source = arrow.direction === "up" || arrow.direction === "left" ? candidates[1] : candidates[0];
    const target = arrow.direction === "up" || arrow.direction === "left" ? candidates[0] : candidates[1];
    if (!source || !target || source.id === target.id) return [];
    const evidence = [evidenceKey(tokens, arrow)];
    return [{ id: `arrow:${arrow.point.row}:${arrow.point.col}`, recognizer: "arrow", priority: 60, confidence: 0.9, consumes: evidence, evidence, value: { edges: [canonicalEdge({ source: source.id, target: target.id, direction: arrow.direction, points: [center(source.sourceBounds), arrow.point, center(target.sourceBounds)], arrow: true })] } }];
  });
}

export function recognizeLineEdges(context: TopologyContext): EdgeCandidate[] {
  const { nodes, tokens } = context;
  const lines = tokens.filter((token): token is Extract<Token, { kind: "line" }> => token.kind === "line");
  const horizontalRows = new Set(lines.filter(line => line.orientation === "horizontal").map(line => line.points[0].row));
  const candidates: EdgeCandidate[] = [];
  for (const line of lines) {
    const bounds = { top: line.points[0].row, left: line.points[0].col, bottom: line.points.at(-1)!.row, right: line.points.at(-1)!.col };
    let source: DiagramNode | undefined, target: DiagramNode | undefined;
    if (line.orientation === "vertical") {
      if (line.points.some(point => horizontalRows.has(point.row - 1) || horizontalRows.has(point.row + 1))) continue;
      if (nodes.some(node => node.sourceBounds.top <= bounds.top && node.sourceBounds.bottom >= bounds.bottom && node.sourceBounds.left <= bounds.left && node.sourceBounds.right >= bounds.right)) continue;
      source = nodes.filter(node => node.sourceBounds.bottom < bounds.top).sort((a, b) => b.sourceBounds.bottom - a.sourceBounds.bottom || Math.abs(center(a.sourceBounds).col - bounds.left) - Math.abs(center(b.sourceBounds).col - bounds.left))[0];
      target = nodes.filter(node => node.sourceBounds.top > bounds.bottom).sort((a, b) => a.sourceBounds.top - b.sourceBounds.top || Math.abs(center(a.sourceBounds).col - bounds.left) - Math.abs(center(b.sourceBounds).col - bounds.left))[0];
    } else {
      source = nodes.filter(node => node.sourceBounds.right < bounds.left && node.sourceBounds.top <= bounds.top && node.sourceBounds.bottom >= bounds.top).sort((a, b) => b.sourceBounds.right - a.sourceBounds.right)[0];
      target = nodes.filter(node => node.sourceBounds.left > bounds.right && node.sourceBounds.top <= bounds.top && node.sourceBounds.bottom >= bounds.top).sort((a, b) => a.sourceBounds.left - b.sourceBounds.left)[0];
    }
    if (!source || !target) continue;
    const recognizer = line.orientation === "vertical" ? "vertical-line" : "horizontal-line";
    const evidence = [evidenceKey(tokens, line)];
    candidates.push({ id: `${recognizer}:${line.points[0].row}:${line.points[0].col}`, recognizer, priority: 40, confidence: 0.82, consumes: evidence, evidence, value: { edges: [canonicalEdge({ source: source.id, target: target.id, direction: line.orientation === "vertical" ? "down" : "right", points: [center(source.sourceBounds), line.points[Math.floor(line.points.length / 2)], center(target.sourceBounds)], arrow: false })] } });
  }
  return candidates;
}

export function recognizeLineBranches(context: TopologyContext): EdgeCandidate[] {
  const { nodes, tokens, glyphs } = context;
  const arrows = tokens.filter((token): token is Extract<Token, { kind: "arrow" }> => token.kind === "arrow");
  const lines = tokens.filter((token): token is Extract<Token, { kind: "line" }> => token.kind === "line");
  const candidates: EdgeCandidate[] = [];
  for (const horizontal of lines.filter(line => line.orientation === "horizontal")) {
    const row = horizontal.points[0].row;
    if (arrows.some(arrow => arrow.direction === "down" && arrow.point.row === row + 1)) continue;
    const left = horizontal.points[0].col, right = horizontal.points.at(-1)!.col;
    const adjacentLines = lines.filter(line => line.orientation === "vertical" && line.points.some(point => point.row === row - 1 || point.row === row + 1));
    const graphColumns = horizontal.points.filter(point => {
      const ports = glyphs.cell(point)?.ports;
      return ports?.has("north") || ports?.has("south");
    }).map(point => point.col);
    const columns = [...new Set([...graphColumns, ...adjacentLines.flatMap(line => line.points.map(point => point.col))])].filter(col => col >= left && col <= right);
    const above = (col: number) => nodes.filter(node => node.sourceBounds.bottom < row && node.sourceBounds.left <= col && node.sourceBounds.right >= col).sort((a, b) => b.sourceBounds.bottom - a.sourceBounds.bottom)[0];
    const below = (col: number) => nodes.filter(node => node.sourceBounds.top > row && node.sourceBounds.left <= col && node.sourceBounds.right >= col).sort((a, b) => a.sourceBounds.top - b.sourceBounds.top)[0];
    const parent = columns.map(above).find(Boolean);
    const branches = columns.map(col => ({ col, target: below(col) })).filter(branch => branch.target);
    if (!parent || !branches.length) continue;
    const evidence = [evidenceKey(tokens, horizontal), ...adjacentLines.map(line => evidenceKey(tokens, line))];
    const edges = branches.map(branch => canonicalEdge({ source: parent.id, target: branch.target!.id, direction: "down", points: [center(parent.sourceBounds), { row, col: branch.col }, center(branch.target!.sourceBounds)], arrow: false }));
    candidates.push({ id: `line-branch:${row}:${left}`, recognizer: "line-branch", priority: 50, confidence: 0.9, consumes: evidence, evidence, value: { edges } });
  }
  return candidates;
}

export function recognizeExampleGroups(context: TopologyContext): Array<RecognitionCandidate<ProposedGroup>> {
  const { nodes, tokens, source } = context;
  const candidates: Array<RecognitionCandidate<ProposedGroup>> = [];
  for (let index = 0; index < nodes.length - 2; index++) {
    const parent = nodes[index], first = nodes[index + 1];
    const gap = source.lines.slice(parent.sourceBounds.bottom + 1, first.sourceBounds.top);
    if (!gap.length || !gap.every(line => line.trim() === "")) continue;
    const members = [first];
    for (let cursor = index + 2; cursor < nodes.length; cursor++) {
      const previous = nodes[cursor - 1], current = nodes[cursor];
      if (current.sourceBounds.top - previous.sourceBounds.bottom !== 1) break;
      if (tokens.some(token => (token.kind === "line" && token.points.some(point => point.row === current.sourceBounds.top)) || (token.kind === "arrow" && token.point.row === current.sourceBounds.top))) break;
      members.push(current);
    }
    if (members.length < 2) continue;
    const looksLikeProse = members.some(member => member.label.length > 32 || /[.!?。！？]$/.test(member.label));
    if (looksLikeProse) continue;
    const evidence = [`blank:${parent.sourceBounds.bottom + 1}:${first.sourceBounds.top - 1}`, ...members.map(member => `node:${member.id}`)];
    candidates.push({
      id: `examples:${parent.id}`, recognizer: "examples", priority: 30, confidence: 0.72,
      consumes: members.map(member => `group-member:${member.id}`), evidence,
      value: {
        kind: "examples", label: "Examples", parent: parent.id, members: members.map(member => member.id),
        sourceBounds: { top: members[0].sourceBounds.top, left: Math.min(...members.map(member => member.sourceBounds.left)), bottom: members.at(-1)!.sourceBounds.bottom, right: Math.max(...members.map(member => member.sourceBounds.right)) }
      }
    });
  }
  return candidates;
}
