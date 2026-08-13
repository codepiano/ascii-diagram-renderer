import type { Diagnostic, Diagram, DiagramGroup, DiagramNode, Point } from "./types.js";

export type CanonicalEdge = {
  source: string;
  target: string;
  direction: "up" | "down" | "left" | "right";
  geometry: { kind: "polyline"; points: Point[] };
  markerEnd: "none" | "arrow";
  label?: { text: string; point: Point };
  provenance: { recognizer: string; evidence: string[]; confidence: number };
};

export type CanonicalGroup = Omit<DiagramGroup, "id"> & {
  provenance: { recognizer: string; evidence: string[]; confidence: number };
};

export type CanonicalDiagram = {
  nodes: DiagramNode[];
  edges: CanonicalEdge[];
  groups: CanonicalGroup[];
  diagnostics: Diagnostic[];
  source: Diagram["source"];
};

const legacyRoute = (edge: CanonicalEdge): Diagram["edges"][number]["sourceRoute"] => {
  if (edge.provenance.recognizer === "cycle") return "cycle";
  if (edge.provenance.recognizer.endsWith("branch")) return "branch";
  if (edge.markerEnd === "arrow") return "orthogonal";
  return edge.direction === "up" || edge.direction === "down" ? "vertical" : "horizontal";
};

/** Compatibility boundary: parser internals can evolve without changing Diagram v1. */
export function toDiagramV1(canonical: CanonicalDiagram): Diagram {
  return {
    version: "1",
    nodes: canonical.nodes,
    edges: canonical.edges.map((edge, index) => ({
      id: `e${index + 1}`,
      source: edge.source,
      target: edge.target,
      direction: edge.direction,
      sourcePath: edge.geometry.points,
      sourceRoute: legacyRoute(edge),
      arrow: edge.markerEnd === "arrow" ? "normal" : "none",
      ...(edge.label ? { label: edge.label.text, labelPoint: edge.label.point } : {})
    })),
    groups: canonical.groups.map(({ provenance: _provenance, ...group }, index) => ({ id: `g${index + 1}`, ...group })),
    diagnostics: canonical.diagnostics,
    source: canonical.source
  };
}
