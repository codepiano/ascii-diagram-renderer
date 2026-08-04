export type Point = { row: number; col: number };
export type Bounds = { top: number; left: number; bottom: number; right: number };
export type NodeShape = "text" | "box" | "rounded-rectangle" | "diamond";
export type Severity = "info" | "warning" | "error";
export type Diagnostic = { code: string; message: string; severity: Severity; source?: Bounds };
export type DiagramKind = "diagram" | "maybe" | "text";
export type DiagramClassification = { kind: DiagramKind; confidence: number; reasons: string[] };
export type ParseOptions = { detection?: "strict" | "lenient" };

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
  sourceRoute?: "vertical" | "horizontal" | "orthogonal";
  arrow?: "none" | "normal";
};

export type DiagramGroup = { id: string; label?: string; members: string[]; sourceBounds?: Bounds };

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
