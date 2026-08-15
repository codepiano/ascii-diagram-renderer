import { createStableId } from "./identity.js";
import { createParseAnalysis } from "./parse-analysis.js";
import { resolveCandidates, summarizeResolution } from "./recognition.js";
import { defaultRecognizerRunner, type RecognizerRunner } from "./recognizer-registry.js";
import type { TopologyContext } from "./topology-recognizers.js";
import type { Diagram, DiagramEdge, DiagramNode, NodeRegion, ParseAnalysis, ParseOptions, PrimitiveDocument } from "./types.js";

/** Resolves independent interpretations into the single public Diagram IR. */
export function recoverTopologyWithAnalysis(primitives: PrimitiveDocument, source: { lines: string[]; width: number; height: number }, options: ParseOptions = {}, recognizers: RecognizerRunner = defaultRecognizerRunner): { diagram: Diagram; regions: NodeRegion[]; analysis: ParseAnalysis } {
  const semanticProfile = options.semanticProfile ?? "llm-common";
  const nodeResolution = resolveCandidates(recognizers.runNodes({ primitives }, semanticProfile));
  const regions = nodeResolution.accepted.map(candidate => candidate.value.region).sort((a, b) => a.bounds.top - b.bounds.top || a.bounds.left - b.bounds.left);
  const nodeOccurrences = new Map<string, number>();
  let nodes: DiagramNode[] = [...regions, ...primitives.boxes].sort((a, b) =>
    a.bounds.top - b.bounds.top || a.bounds.left - b.bounds.left
  ).map(primitive => {
    const label = primitive.label;
    const shape = primitive.kind === "box" ? "box" : "text";
    const fingerprint = `${shape}\u001f${label}`;
    const occurrence = (nodeOccurrences.get(fingerprint) ?? 0) + 1;
    nodeOccurrences.set(fingerprint, occurrence);
    return {
      id: createStableId("node", [shape, label], occurrence),
      label,
      shape,
      sourceBounds: primitive.bounds,
      ...(primitive.kind === "text" ? { metadata: { regionId: primitive.id, runIds: primitive.runIds } } : {})
    };
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
  let groups = groupResolution.accepted.map(candidate => {
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
  for (const section of groups.filter(group => group.kind === "group" && group.parent)) {
    const parent = nodes.find(node => node.id === section.parent);
    if (!parent) continue;
    parent.metadata = {
      ...(parent.metadata ?? {}),
      section: { title: parent.label, contentNodeIds: [...section.members] }
    };
  }
  for (const node of nodes) {
    const lines = node.label.split("\n");
    if (lines.length > 1 && /^\[[^\]]+\]/.test(lines[0].trim())) {
      node.metadata = {
        ...(node.metadata ?? {}),
        section: { title: lines[0], content: lines.slice(1) }
      };
    }
  }
  const sectionMemberIds = new Set<string>();
  for (const section of groups.filter(group => group.kind === "group" && group.parent)) {
    const parent = nodes.find(node => node.id === section.parent);
    const members = nodes.filter(node => section.members.includes(node.id));
    if (!parent || !members.length) continue;
    const row = Math.min(...members.map(member => member.sourceBounds.top));
    const content = source.lines[row]?.trim() ?? members.map(member => member.label).join(" -> ");
    parent.label = `${parent.label}\n${content}`;
    parent.sourceBounds = {
      top: parent.sourceBounds.top,
      left: Math.min(parent.sourceBounds.left, ...members.map(member => member.sourceBounds.left)),
      bottom: Math.max(parent.sourceBounds.bottom, ...members.map(member => member.sourceBounds.bottom)),
      right: Math.max(parent.sourceBounds.right, ...members.map(member => member.sourceBounds.right))
    };
    parent.metadata = {
      ...(parent.metadata ?? {}),
      section: { title: parent.label.split("\n")[0], content: { kind: "inline-flow", text: content } }
    };
    members.forEach(member => sectionMemberIds.add(member.id));
  }
  if (sectionMemberIds.size) {
    nodes = nodes.filter(node => !sectionMemberIds.has(node.id));
    for (let index = edges.length - 1; index >= 0; index--) {
      if (sectionMemberIds.has(edges[index].source) || sectionMemberIds.has(edges[index].target)) edges.splice(index, 1);
    }
    groups = groups.filter(group => group.kind !== "group");
  }
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
  return { diagram, regions, analysis };
}
