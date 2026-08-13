export type Point = { row: number; col: number };
export type Bounds = { top: number; left: number; bottom: number; right: number };
export type NodeShape = "text" | "box" | "rounded-rectangle" | "diamond";
export type Severity = "info" | "warning" | "error";
export type Diagnostic = { code: string; message: string; severity: Severity; source?: Bounds };
export type DiagramKind = "diagram" | "maybe" | "text";
export type DiagramClassification = { kind: DiagramKind; confidence: number; reasons: string[] };
export type ParseOptions = { detection?: "strict" | "lenient" };
export type RecognitionPhase = "node" | "edge" | "group";
export type RecognitionSummary = {
  id: string;
  phase: RecognitionPhase;
  recognizer: string;
  confidence: number;
  evidence: string[];
  consumes: string[];
};
export type RejectedRecognitionSummary = RecognitionSummary & {
  reason: "conflict" | "low-confidence";
  conflictsWith?: string;
};
export type ParseAnalysis = {
  accepted: RecognitionSummary[];
  rejected: RejectedRecognitionSummary[];
  unconsumedEvidence: string[];
  metrics: {
    nodeCount: number;
    edgeCount: number;
    groupCount: number;
    arrowCount: number;
    unresolvedArrowCount: number;
    boxCount: number;
    connectorComponentCount: number;
    verticalConnectorCellCount: number;
    likelyMarkdownList: boolean;
    maxEdgeConfidence: number;
  };
  diagnostics: Diagnostic[];
};

export type Token =
  | { kind: "text"; text: string; bounds: Bounds }
  | { kind: "line"; orientation: "horizontal" | "vertical"; points: Point[] }
  | { kind: "junction"; point: Point }
  | { kind: "arrow"; direction: "up" | "down" | "left" | "right"; point: Point }
  | { kind: "box"; bounds: Bounds; label: string };

export type DiagramNode = {
  id: string;
  label: string;
  shape: NodeShape;
  sourceBounds: Bounds;
  metadata?: Record<string, unknown>;
};

export type DiagramEdge = {
  id: string;
  source: string;
  target: string;
  direction: "up" | "down" | "left" | "right";
  sourcePath: Point[];
  sourceRoute?: "vertical" | "horizontal" | "orthogonal" | "branch" | "cycle";
  arrow?: "none" | "normal";
  /** Text carried by a connection rather than a standalone diagram node. */
  label?: string;
  labelPoint?: Point;
};

export type DiagramGroup = { id: string; kind: "examples" | "group"; label?: string; parent?: string; members: string[]; sourceBounds?: Bounds };

export type EdgePort = "top" | "right" | "bottom" | "left";
export type RecognitionProvenance = { recognizer: string; evidence: string[]; confidence: number };
export type DiagramV2Edge = {
  id: string;
  source: string;
  target: string;
  direction: "up" | "down" | "left" | "right";
  geometry: { kind: "polyline"; points: Point[]; sourcePort: EdgePort; targetPort: EdgePort };
  markerEnd: "none" | "arrow";
  label?: { text: string; point: Point };
  provenance: RecognitionProvenance;
};
export type DiagramV2Group = Omit<DiagramGroup, "id"> & { id: string; provenance: RecognitionProvenance };
export type DiagramV2 = {
  version: "2";
  nodes: DiagramNode[];
  edges: DiagramV2Edge[];
  groups: DiagramV2Group[];
  diagnostics: Diagnostic[];
  source: { lines: string[]; width: number; height: number };
};

export type Diagram = {
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  groups: DiagramGroup[];
  version: "1";
  diagnostics: Diagnostic[];
  source: { lines: string[]; width: number; height: number };
};

export type LayoutedNode = DiagramNode & { layout: { x: number; y: number; width: number; height: number } };
export type LayoutedEdge = DiagramEdge & { layout: { points: Point[] } };
export type LayoutedDiagram = { diagram: Diagram; nodes: LayoutedNode[]; edges: LayoutedEdge[] };

export type RenderOptions = {
  mode?: "preserve" | "reflow";
  cellWidth?: number;
  cellHeight?: number;
  padding?: number;
  fontFamily?: string;
  fontSize?: number;
};
