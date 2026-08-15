import { createStableId } from "./identity.js";
import type { RecognitionCandidate } from "./recognition.js";
import type { Bounds, NodeRegion, NodeRegionInterpretation, PrimitiveDocument, TextRun } from "./types.js";

export type NodeRegionContext = {
  primitives: PrimitiveDocument;
};

const centerColumn = (run: TextRun) => (run.bounds.left + run.bounds.right) / 2;
const overlapWidth = (a: Bounds, b: Bounds) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left) + 1);
const runWidth = (run: TextRun) => run.bounds.right - run.bounds.left + 1;
const isBracketedLabel = (run: TextRun) => /^\[[^\]]+\]$/.test(run.text.trim());
const isDelimitedContinuation = (upper: TextRun, lower: TextRun) =>
  /[/／]\s*$/.test(upper.text) && /[/／]/.test(lower.text);
const regionBounds = (runs: TextRun[]): Bounds => ({
  top: Math.min(...runs.map(run => run.bounds.top)),
  left: Math.min(...runs.map(run => run.bounds.left)),
  bottom: Math.max(...runs.map(run => run.bounds.bottom)),
  right: Math.max(...runs.map(run => run.bounds.right))
});
const region = (runs: TextRun[]): NodeRegion => {
  const ordered = [...runs].sort((a, b) => a.bounds.top - b.bounds.top || a.bounds.left - b.bounds.left);
  const runIds = ordered.map(run => run.id);
  return {
    id: createStableId("region", runIds),
    kind: "text",
    runIds,
    label: ordered.map(run => run.text).join("\n"),
    bounds: regionBounds(ordered)
  };
};

/** Single-line regions are the conservative fallback when no multiline interpretation wins. */
export function recognizeSingleLineRegions(context: NodeRegionContext): Array<RecognitionCandidate<NodeRegionInterpretation>> {
  return context.primitives.textRuns.map(run => ({
    id: `single-line-region:${run.id}`,
    recognizer: "single-line-region",
    priority: 10,
    confidence: 1,
    consumes: [`text-run:${run.id}`],
    evidence: [run.id],
    value: { region: region([run]) }
  }));
}

type Adjacency = { upper: TextRun; lower: TextRun; score: number };
const regionPolicy = {
  minimumAdjacency: 0.55,
  baseConfidence: 0.48,
  alignmentWeight: 0.12,
  connectorAnchorWeight: 0.18,
  delimitedContinuationWeight: 0.18,
  prosePenalty: 0.3
} as const;

const adjacencyScore = (upper: TextRun, lower: TextRun, context: NodeRegionContext) => {
  if (lower.bounds.top !== upper.bounds.bottom + 1) return 0;
  // A bracketed label can introduce plain text content, but not a row that is
  // itself part of a connector topology (for example, a horizontal process).
  const lowerRowHasTopology = context.primitives.connectors.some(connector =>
    connector.cells.some(cell => cell.point.row === lower.bounds.top)
  ) || context.primitives.arrows.some(arrow => arrow.point.row === lower.bounds.top);
  if (isBracketedLabel(upper) && !isBracketedLabel(lower) && lowerRowHasTopology) return 0;
  const overlap = overlapWidth(upper.bounds, lower.bounds);
  const minWidth = Math.min(runWidth(upper), runWidth(lower));
  const overlapRatio = minWidth ? overlap / minWidth : 0;
  const centerDistance = Math.abs(centerColumn(upper) - centerColumn(lower));
  const alignment = Math.max(0, 1 - centerDistance / Math.max(2, minWidth));
  return overlapRatio * 0.7 + alignment * 0.3;
};

const bestAdjacencies = (runs: TextRun[], context: NodeRegionContext) => {
  const byRow = new Map<number, TextRun[]>();
  for (const run of runs) byRow.set(run.bounds.top, [...(byRow.get(run.bounds.top) ?? []), run]);
  const matches: Adjacency[] = [];
  for (const [row, upperRuns] of byRow) {
    const lowerRuns = byRow.get(row + 1) ?? [];
    const candidates = upperRuns.flatMap(upper => lowerRuns.map(lower => ({ upper, lower, score: adjacencyScore(upper, lower, context) }))).filter(match => match.score >= regionPolicy.minimumAdjacency);
    const bestByUpper = new Map<string, Adjacency>(), bestByLower = new Map<string, Adjacency>();
    for (const candidate of candidates) {
      const upperBest = bestByUpper.get(candidate.upper.id);
      if (!upperBest || candidate.score > upperBest.score || (candidate.score === upperBest.score && candidate.lower.id < upperBest.lower.id)) bestByUpper.set(candidate.upper.id, candidate);
      const lowerBest = bestByLower.get(candidate.lower.id);
      if (!lowerBest || candidate.score > lowerBest.score || (candidate.score === lowerBest.score && candidate.upper.id < lowerBest.upper.id)) bestByLower.set(candidate.lower.id, candidate);
    }
    matches.push(...candidates.filter(candidate => bestByUpper.get(candidate.upper.id) === candidate && bestByLower.get(candidate.lower.id) === candidate));
  }
  return matches;
};

const connectedComponents = (runs: TextRun[], adjacencies: Adjacency[]) => {
  const neighbors = new Map(runs.map(run => [run.id, new Set<string>()]));
  for (const { upper, lower } of adjacencies) {
    neighbors.get(upper.id)!.add(lower.id);
    neighbors.get(lower.id)!.add(upper.id);
  }
  const byId = new Map(runs.map(run => [run.id, run]));
  const visited = new Set<string>();
  const components: TextRun[][] = [];
  for (const run of runs) {
    if (visited.has(run.id)) continue;
    const pending = [run.id], component: TextRun[] = [];
    visited.add(run.id);
    while (pending.length) {
      const id = pending.pop()!;
      component.push(byId.get(id)!);
      for (const neighbor of neighbors.get(id)!) if (!visited.has(neighbor)) {
        visited.add(neighbor);
        pending.push(neighbor);
      }
    }
    if (component.length > 1) components.push(component);
  }
  return components;
};

const adjacentConnectorIds = (document: PrimitiveDocument, bounds: Bounds, row: number, facingRegion: "north" | "south") => document.connectors.filter(connector =>
  connector.cells.some(cell => cell.point.row === row && cell.point.col >= bounds.left && cell.point.col <= bounds.right && cell.ports.includes(facingRegion))
).map(connector => connector.id);

/**
 * Grows multiline candidates from mutually best vertical TextRun neighbors.
 * Connectors are hard barriers: growth only crosses directly adjacent text rows;
 * connectors may anchor the outside of a region but are never crossed.
 */
export function recognizeMultilineRegions(context: NodeRegionContext): Array<RecognitionCandidate<NodeRegionInterpretation>> {
  const adjacencies = bestAdjacencies(context.primitives.textRuns, context);
  return connectedComponents(context.primitives.textRuns, adjacencies).map(runs => {
    const value = region(runs);
    const relevant = adjacencies.filter(match => value.runIds.includes(match.upper.id) && value.runIds.includes(match.lower.id));
    const alignment = relevant.reduce((sum, match) => sum + match.score, 0) / relevant.length;
    const above = adjacentConnectorIds(context.primitives, value.bounds, value.bounds.top - 1, "south");
    const below = adjacentConnectorIds(context.primitives, value.bounds, value.bounds.bottom + 1, "north");
    const ordered = [...runs].sort((a, b) => a.bounds.top - b.bounds.top || a.bounds.left - b.bounds.left);
    const hasDelimitedContinuation = ordered.slice(0, -1).some((run, index) => isDelimitedContinuation(run, ordered[index + 1]));
    const looksLikeProse = !hasDelimitedContinuation && runs.some(run => run.text.length > 32 || /[.!?。！？]$/.test(run.text));
    const confidence = Math.max(0, Math.min(1,
      regionPolicy.baseConfidence +
      alignment * regionPolicy.alignmentWeight +
      (above.length ? regionPolicy.connectorAnchorWeight : 0) +
      (below.length ? regionPolicy.connectorAnchorWeight : 0) +
      (hasDelimitedContinuation ? regionPolicy.delimitedContinuationWeight : 0) -
      (looksLikeProse ? regionPolicy.prosePenalty : 0)
    ));
    return {
      id: `multiline-region:${value.id}`,
      recognizer: "multiline-region",
      priority: 70,
      confidence,
      consumes: value.runIds.map(id => `text-run:${id}`),
      evidence: [...value.runIds, ...new Set([...above, ...below])],
      value: { region: value }
    };
  });
}
