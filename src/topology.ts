import { toDiagramV1, toDiagramV2, type CanonicalDiagram, type CanonicalEdge } from "./canonical.js";
import { CharacterGrid } from "./grid.js";
import { GlyphGraph } from "./glyph-graph.js";
import { createStableId } from "./identity.js";
import { createParseAnalysis } from "./parse-analysis.js";
import { resolveCandidates, summarizeResolution } from "./recognition.js";
import {
  recognizeArrows,
  recognizeArrowBranches,
  recognizeCycles,
  recognizeExampleGroups,
  recognizeLineBranches,
  recognizeLineEdges,
  recognizeMultilineNodes,
  type TopologyContext
} from "./topology-recognizers.js";
import type { Diagram, DiagramNode, DiagramV2, ParseAnalysis, Token } from "./types.js";

const nodeTokens = (tokens: Token[]) => tokens.filter((token): token is Extract<Token, { kind: "text" | "box" }> => token.kind === "text" || token.kind === "box");
const edgeRecognizers = [recognizeArrowBranches, recognizeArrows, recognizeLineBranches, recognizeLineEdges];

/**
 * Resolves independent interpretations into canonical topology, then adapts it
 * to the stable Diagram v1 contract. Recognizer registration order is not a
 * precedence mechanism; priorities and consumed evidence decide conflicts.
 */
export function recoverTopology(tokens: Token[], source: { lines: string[]; width: number; height: number }, glyphs = new GlyphGraph(new CharacterGrid(source.lines.join("\n")))): Diagram {
  return recoverTopologyWithAnalysis(tokens, source, glyphs).diagram;
}

export function recoverTopologyWithAnalysis(tokens: Token[], source: { lines: string[]; width: number; height: number }, glyphs = new GlyphGraph(new CharacterGrid(source.lines.join("\n")))): { diagram: Diagram; diagramV2: DiagramV2; analysis: ParseAnalysis } {
  const nodeOccurrences = new Map<string, number>();
  let nodes: DiagramNode[] = nodeTokens(tokens).map(token => {
    const label = token.kind === "box" ? token.label : token.text;
    const shape = token.kind === "box" ? "box" : "text";
    const fingerprint = `${shape}\u001f${label}`;
    const occurrence = (nodeOccurrences.get(fingerprint) ?? 0) + 1;
    nodeOccurrences.set(fingerprint, occurrence);
    return {
      id: createStableId("node", [shape, label], occurrence),
      label,
      shape,
      sourceBounds: token.bounds
    };
  });
  const nodeResolution = resolveCandidates(recognizeMultilineNodes(nodes, tokens), { minimumConfidence: 0.6 });
  const removedNodes = new Set(nodeResolution.accepted.flatMap(candidate => candidate.value.merge.members.filter(id => id !== candidate.value.merge.primary)));
  const nodeReplacements = new Map(nodeResolution.accepted.map(candidate => [candidate.value.merge.primary, candidate.value.merge]));
  nodes = nodes.filter(node => !removedNodes.has(node.id)).map(node => {
    const replacement = nodeReplacements.get(node.id);
    return replacement ? { ...node, label: replacement.label, sourceBounds: replacement.sourceBounds } : node;
  });

  const context: TopologyContext = { nodes, tokens, source, glyphs };
  const cycleCandidates = recognizeCycles(context);
  const edgeResolution = resolveCandidates([
    ...cycleCandidates,
    ...edgeRecognizers.flatMap(recognize => recognize(context))
  ], { minimumConfidence: 0.6 });
  const excludedNodes = new Set(edgeResolution.accepted.flatMap(candidate => candidate.value.excludeNodes ?? []));
  nodes = nodes.filter(node => !excludedNodes.has(node.id));

  const edges: CanonicalEdge[] = [];
  const edgeOccurrences = new Map<string, number>();
  for (const candidate of edgeResolution.accepted) for (const proposed of candidate.value.edges) {
    const fingerprint = `${proposed.source}\u001f${proposed.target}\u001f${candidate.recognizer}\u001f${proposed.label?.text ?? ""}`;
    const occurrence = (edgeOccurrences.get(fingerprint) ?? 0) + 1;
    edgeOccurrences.set(fingerprint, occurrence);
    const edge: CanonicalEdge = {
      ...proposed,
      id: createStableId("edge", [proposed.source, proposed.target, candidate.recognizer, proposed.label?.text ?? ""], occurrence),
      provenance: { recognizer: candidate.recognizer, evidence: candidate.evidence, confidence: candidate.confidence }
    };
    if (!nodes.some(node => node.id === edge.source) || !nodes.some(node => node.id === edge.target)) continue;
    if (edges.some(existing => existing.source === edge.source && existing.target === edge.target)) continue;
    edges.push(edge);
  }

  const groupContext: TopologyContext = { nodes, tokens, source, glyphs };
  const groupResolution = resolveCandidates(recognizeExampleGroups(groupContext), { minimumConfidence: 0.6 });
  const groupOccurrences = new Map<string, number>();
  const groups = groupResolution.accepted.map(candidate => {
    const parts = [candidate.recognizer, candidate.value.parent ?? "", ...candidate.value.members];
    const fingerprint = parts.join("\u001f");
    const occurrence = (groupOccurrences.get(fingerprint) ?? 0) + 1;
    groupOccurrences.set(fingerprint, occurrence);
    return {
      ...candidate.value,
      id: createStableId("group", parts, occurrence),
      provenance: { recognizer: candidate.recognizer, evidence: candidate.evidence, confidence: candidate.confidence }
    };
  });
  const diagnostics: Diagram["diagnostics"] = nodes.length === 0
    ? [{ code: "NO_NODES", message: "No supported diagram nodes were found.", severity: "warning" }]
    : [];

  const consumedEvidence = new Set(edgeResolution.accepted.flatMap(candidate => candidate.consumes));
  const unresolvedArrow = tokens.some((token, index) => token.kind === "arrow" && !consumedEvidence.has(`token:${index}`));
  if (unresolvedArrow) diagnostics.push({ code: "UNRESOLVED_ARROW", message: "One or more arrows could not be connected to two nodes.", severity: "warning" });

  const nodeOrder = new Map(nodes.map((node, index) => [node.id, index]));
  edges.sort((a, b) => (nodeOrder.get(a.source)! - nodeOrder.get(b.source)!) || (nodeOrder.get(a.target)! - nodeOrder.get(b.target)!));
  const canonical: CanonicalDiagram = { version: "2", nodes, edges, groups, diagnostics, source };
  const diagram = toDiagramV1(canonical);
  const diagramV2 = toDiagramV2(canonical);
  const nodeSummary = summarizeResolution("node", nodeResolution);
  const edgeSummary = summarizeResolution("edge", edgeResolution);
  const groupSummary = summarizeResolution("group", groupResolution);
  const accepted = [
    ...nodeSummary.accepted,
    ...edgeSummary.accepted,
    ...groupSummary.accepted
  ];
  const rejected = [
    ...nodeSummary.rejected,
    ...edgeSummary.rejected,
    ...groupSummary.rejected
  ];
  const analysis = createParseAnalysis({
    tokens,
    glyphs,
    nodeCount: nodes.length,
    edgeCount: edges.length,
    groupCount: groups.length,
    accepted,
    rejected,
    diagnostics
  });
  return { diagram, diagramV2, analysis };
}
