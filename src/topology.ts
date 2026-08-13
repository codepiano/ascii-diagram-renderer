import { toDiagramV1, type CanonicalDiagram, type CanonicalEdge } from "./canonical.js";
import { CharacterGrid } from "./grid.js";
import { GlyphGraph } from "./glyph-graph.js";
import { resolveCandidates } from "./recognition.js";
import {
  normalizeMultilineNodes,
  recognizeArrows,
  recognizeArrowBranches,
  recognizeCycles,
  recognizeExampleGroups,
  recognizeLineBranches,
  recognizeLineEdges,
  type TopologyContext
} from "./topology-recognizers.js";
import type { Diagram, DiagramNode, Token } from "./types.js";

const nodeTokens = (tokens: Token[]) => tokens.filter((token): token is Extract<Token, { kind: "text" | "box" }> => token.kind === "text" || token.kind === "box");
const edgeRecognizers = [recognizeArrowBranches, recognizeArrows, recognizeLineBranches, recognizeLineEdges];

/**
 * Resolves independent interpretations into canonical topology, then adapts it
 * to the stable Diagram v1 contract. Recognizer registration order is not a
 * precedence mechanism; priorities and consumed evidence decide conflicts.
 */
export function recoverTopology(tokens: Token[], source: { lines: string[]; width: number; height: number }, glyphs = new GlyphGraph(new CharacterGrid(source.lines.join("\n")))): Diagram {
  let nodes: DiagramNode[] = nodeTokens(tokens).map((token, index) => ({
    id: `n${index + 1}`,
    label: token.kind === "box" ? token.label : token.text,
    shape: token.kind === "box" ? "box" : "text",
    sourceBounds: token.bounds
  }));
  nodes = normalizeMultilineNodes(nodes, tokens);

  const initialContext: TopologyContext = { nodes, tokens, source, glyphs };
  const cycleCandidates = recognizeCycles(initialContext);
  const cycleResolution = resolveCandidates(cycleCandidates);
  const excludedNodes = new Set(cycleResolution.accepted.flatMap(candidate => candidate.value.excludeNodes ?? []));
  nodes = nodes.filter(node => !excludedNodes.has(node.id));

  const context: TopologyContext = { nodes, tokens, source, glyphs };
  const edgeResolution = resolveCandidates([
    ...cycleCandidates,
    ...edgeRecognizers.flatMap(recognize => recognize(context))
  ]);

  const edges: CanonicalEdge[] = [];
  for (const candidate of edgeResolution.accepted) for (const proposed of candidate.value.edges) {
    const edge: CanonicalEdge = {
      ...proposed,
      provenance: { recognizer: candidate.recognizer, evidence: candidate.evidence, confidence: candidate.confidence }
    };
    if (!nodes.some(node => node.id === edge.source) || !nodes.some(node => node.id === edge.target)) continue;
    if (edges.some(existing => existing.source === edge.source && existing.target === edge.target)) continue;
    edges.push(edge);
  }

  const groupResolution = resolveCandidates(recognizeExampleGroups(context));
  const groups = groupResolution.accepted.map(candidate => ({
    ...candidate.value,
    provenance: { recognizer: candidate.recognizer, evidence: candidate.evidence, confidence: candidate.confidence }
  }));
  const diagnostics: Diagram["diagnostics"] = nodes.length === 0
    ? [{ code: "NO_NODES", message: "No supported diagram nodes were found.", severity: "warning" }]
    : [];

  const consumedEvidence = new Set(edgeResolution.accepted.flatMap(candidate => candidate.consumes));
  const unresolvedArrow = tokens.some((token, index) => token.kind === "arrow" && !consumedEvidence.has(`token:${index}`));
  if (unresolvedArrow) diagnostics.push({ code: "UNRESOLVED_ARROW", message: "One or more arrows could not be connected to two nodes.", severity: "warning" });

  const nodeOrder = new Map(nodes.map((node, index) => [node.id, index]));
  edges.sort((a, b) => (nodeOrder.get(a.source)! - nodeOrder.get(b.source)!) || (nodeOrder.get(a.target)! - nodeOrder.get(b.target)!));
  const canonical: CanonicalDiagram = { nodes, edges, groups, diagnostics, source };
  return toDiagramV1(canonical);
}
