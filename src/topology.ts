import { createStableId } from "./identity.js";
import { createParseAnalysis } from "./parse-analysis.js";
import { resolveCandidates, summarizeResolution } from "./recognition.js";
import { defaultRecognizerRunner, type RecognizerRunner } from "./recognizer-registry.js";
import type { TopologyContext } from "./topology-recognizers.js";
import type { Diagram, DiagramEdge, DiagramNode, ParseAnalysis, ParseOptions, PrimitiveDocument } from "./types.js";

/** Resolves independent interpretations into the single public Diagram IR. */
export function recoverTopologyWithAnalysis(primitives: PrimitiveDocument, source: { lines: string[]; width: number; height: number }, options: ParseOptions = {}, recognizers: RecognizerRunner = defaultRecognizerRunner): { diagram: Diagram; analysis: ParseAnalysis } {
  const semanticProfile = options.semanticProfile ?? "llm-common";
  const nodeOccurrences = new Map<string, number>();
  let nodes: DiagramNode[] = [...primitives.texts, ...primitives.boxes].sort((a, b) => a.bounds.top - b.bounds.top || a.bounds.left - b.bounds.left).map(primitive => {
    const label = primitive.kind === "box" ? primitive.label : primitive.text;
    const shape = primitive.kind === "box" ? "box" : "text";
    const fingerprint = `${shape}\u001f${label}`;
    const occurrence = (nodeOccurrences.get(fingerprint) ?? 0) + 1;
    nodeOccurrences.set(fingerprint, occurrence);
    return {
      id: createStableId("node", [shape, label], occurrence),
      label,
      shape,
      sourceBounds: primitive.bounds
    };
  });
  const nodeResolution = resolveCandidates(recognizers.runNodes(nodes, primitives, semanticProfile));
  const removedNodes = new Set(nodeResolution.accepted.flatMap(candidate => candidate.value.merge.members.filter(id => id !== candidate.value.merge.primary)));
  const nodeReplacements = new Map(nodeResolution.accepted.map(candidate => [candidate.value.merge.primary, candidate.value.merge]));
  nodes = nodes.filter(node => !removedNodes.has(node.id)).map(node => {
    const replacement = nodeReplacements.get(node.id);
    return replacement ? { ...node, label: replacement.label, sourceBounds: replacement.sourceBounds } : node;
  });

  const context: TopologyContext = { nodes, primitives, source };
  const edgeResolution = resolveCandidates(recognizers.runEdges(context, semanticProfile));
  const excludedNodes = new Set(edgeResolution.accepted.flatMap(candidate => candidate.value.excludeNodes ?? []));
  nodes = nodes.filter(node => !excludedNodes.has(node.id));

  const edges: DiagramEdge[] = [];
  const edgeOccurrences = new Map<string, number>();
  for (const candidate of edgeResolution.accepted) for (const proposed of candidate.value.edges) {
    const fingerprint = `${proposed.source}\u001f${proposed.target}\u001f${candidate.recognizer}\u001f${proposed.label?.text ?? ""}`;
    const occurrence = (edgeOccurrences.get(fingerprint) ?? 0) + 1;
    edgeOccurrences.set(fingerprint, occurrence);
    const edge: DiagramEdge = {
      ...proposed,
      id: createStableId("edge", [proposed.source, proposed.target, candidate.recognizer, proposed.label?.text ?? ""], occurrence),
      provenance: { recognizer: candidate.recognizer, evidence: candidate.evidence, confidence: candidate.confidence }
    };
    if (!nodes.some(node => node.id === edge.source) || !nodes.some(node => node.id === edge.target)) continue;
    if (edges.some(existing => existing.source === edge.source && existing.target === edge.target)) continue;
    edges.push(edge);
  }

  const groupContext: TopologyContext = { nodes, primitives, source };
  const groupResolution = resolveCandidates(recognizers.runGroups(groupContext, semanticProfile));
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
  const unresolvedArrow = primitives.arrows.some(arrow => !consumedEvidence.has(arrow.id));
  if (unresolvedArrow) diagnostics.push({ code: "UNRESOLVED_ARROW", message: "One or more arrows could not be connected to two nodes.", severity: "warning" });

  const nodeOrder = new Map(nodes.map((node, index) => [node.id, index]));
  edges.sort((a, b) => (nodeOrder.get(a.source)! - nodeOrder.get(b.source)!) || (nodeOrder.get(a.target)! - nodeOrder.get(b.target)!));
  const diagram: Diagram = { version: "2", nodes, edges, groups, diagnostics, source };
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
    primitives,
    nodeCount: nodes.length,
    edgeCount: edges.length,
    groupCount: groups.length,
    accepted,
    rejected,
    diagnostics
  });
  return { diagram, analysis };
}
