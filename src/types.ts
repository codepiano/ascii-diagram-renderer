export type Point = { row: number; col: number };
export type Bounds = { top: number; left: number; bottom: number; right: number };
export type NodeShape = "text" | "box" | "rounded-rectangle" | "diamond";
export type Severity = "info" | "warning" | "error";
export type Diagnostic = { code: string; message: string; severity: Severity; source?: Bounds };
export type DiagramKind = "diagram" | "maybe" | "text";
export type DiagramClassification = { kind: DiagramKind; confidence: number; reasons: string[] };
export type SemanticProfile = "none" | "llm-common";
export type ParseOptions = { detection?: "strict" | "lenient"; semanticProfile?: SemanticProfile };
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

export type PrimitiveText = { id: string; kind: "text"; text: string; bounds: Bounds };
export type PrimitiveBox = { id: string; kind: "box"; label: string; bounds: Bounds };
export type PrimitiveArrow = { id: string; kind: "arrow"; direction: "up" | "down" | "left" | "right"; point: Point };
export type ConnectorPort = "north" | "east" | "south" | "west";
export type PrimitiveConnectorCell = { point: Point; char: string; ports: ConnectorPort[] };
export type PrimitiveConnectorPath = { id: string; points: Point[]; closed: boolean };
export type PrimitiveConnector = {
  id: string;
  kind: "connector";
  bounds: Bounds;
  cells: PrimitiveConnectorCell[];
  endpoints: Point[];
  junctions: Point[];
  paths: PrimitiveConnectorPath[];
};
export type SourcePrimitive = PrimitiveText | PrimitiveBox | PrimitiveArrow | PrimitiveConnector;
export type PrimitiveDocument = {
  version: "1";
  items: SourcePrimitive[];
  texts: PrimitiveText[];
  boxes: PrimitiveBox[];
  arrows: PrimitiveArrow[];
  connectors: PrimitiveConnector[];
};

export type DiagramNode = {
  id: string;
  label: string;
  shape: NodeShape;
  sourceBounds: Bounds;
  metadata?: Record<string, unknown>;
};

export type EdgePort = "top" | "right" | "bottom" | "left";
export type RecognitionProvenance = { recognizer: string; evidence: string[]; confidence: number };
export type DiagramEdge = {
  id: string;
  source: string;
  target: string;
  direction: "up" | "down" | "left" | "right";
  geometry: { kind: "polyline"; points: Point[]; sourcePort: EdgePort; targetPort: EdgePort };
  markerEnd: "none" | "arrow";
  label?: { text: string; point: Point };
  provenance: RecognitionProvenance;
};
export type DiagramGroup = {
  id: string;
  kind: "examples" | "group";
  label?: string;
  parent?: string;
  members: string[];
  sourceBounds?: Bounds;
  provenance: RecognitionProvenance;
};
export type Diagram = {
  version: "2";
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  groups: DiagramGroup[];
  diagnostics: Diagnostic[];
  source: { lines: string[]; width: number; height: number };
};

export type RenderOptions = {
  mode?: "preserve" | "reflow";
  cellWidth?: number;
  cellHeight?: number;
  padding?: number;
  fontFamily?: string;
  fontSize?: number;
};
