import type { Diagram, DiagramV2, DiagramV2Edge, DiagramV2Group } from "./types.js";

export type CanonicalEdge = DiagramV2Edge;
export type CanonicalGroup = DiagramV2Group;
export type CanonicalDiagram = DiagramV2;

const legacyRoute = (edge: CanonicalEdge): Diagram["edges"][number]["sourceRoute"] => {
  if (edge.provenance.recognizer === "cycle") return "cycle";
  if (edge.provenance.recognizer.endsWith("branch")) return "branch";
  if (edge.markerEnd === "arrow") return "orthogonal";
  return edge.direction === "up" || edge.direction === "down" ? "vertical" : "horizontal";
};

export function toDiagramV2(canonical: CanonicalDiagram): DiagramV2 { return canonical; }

/** Compatibility boundary: stable canonical ids and geometry stay behind Diagram v1. */
export function toDiagramV1(canonical: CanonicalDiagram): Diagram {
  const nodeIds = new Map(canonical.nodes.map((node, index) => [node.id, `n${index + 1}`]));
  return {
    version: "1",
    nodes: canonical.nodes.map(node => ({ ...node, id: nodeIds.get(node.id)! })),
    edges: canonical.edges.map((edge, index) => ({
      id: `e${index + 1}`,
      source: nodeIds.get(edge.source)!,
      target: nodeIds.get(edge.target)!,
      direction: edge.direction,
      sourcePath: edge.geometry.points,
      sourceRoute: legacyRoute(edge),
      arrow: edge.markerEnd === "arrow" ? "normal" : "none",
      ...(edge.label ? { label: edge.label.text, labelPoint: edge.label.point } : {})
    })),
    groups: canonical.groups.map(({ provenance: _provenance, ...group }, index) => ({
      ...group,
      id: `g${index + 1}`,
      ...(group.parent ? { parent: nodeIds.get(group.parent) } : {}),
      members: group.members.map(id => nodeIds.get(id)!)
    })),
    diagnostics: canonical.diagnostics,
    source: canonical.source
  };
}
