import type { Diagram, DiagramClassification, ParseAnalysis, ParseOptions, Token } from "./types.js";

const legacyAnalysis = (tokens: Token[], diagram?: Diagram): ParseAnalysis => {
  const arrows = tokens.filter(token => token.kind === "arrow");
  const lines = tokens.filter((token): token is Extract<Token, { kind: "line" }> => token.kind === "line");
  const nodes = tokens.filter(token => token.kind === "text" || token.kind === "box").length;
  const boxes = tokens.filter(token => token.kind === "box").length;
  const edgeCount = diagram?.edges.length ?? 0;
  const resolvedArrows = diagram?.edges.filter(edge => edge.arrow === "normal").length ?? 0;
  return {
    accepted: [], rejected: [], unconsumedEvidence: [], diagnostics: diagram?.diagnostics ?? [],
    metrics: {
      nodeCount: nodes,
      edgeCount,
      groupCount: diagram?.groups.length ?? 0,
      arrowCount: arrows.length,
      unresolvedArrowCount: Math.max(0, arrows.length - resolvedArrows),
      boxCount: boxes,
      connectorComponentCount: lines.length,
      verticalConnectorCellCount: lines.filter(line => line.orientation === "vertical").length,
      likelyMarkdownList: arrows.length === 0 && lines.length > 0 && lines.every(line => line.orientation === "horizontal" && line.points.length === 1),
      maxEdgeConfidence: edgeCount ? (arrows.length ? 0.98 : 0.92) : 0
    }
  };
};

function classifyAnalysis(analysis: ParseAnalysis, options: ParseOptions): DiagramClassification {
  const mode = options.detection ?? "strict";
  const metrics = analysis.metrics;
  if (metrics.nodeCount === 0) return { kind: "text", confidence: 1, reasons: ["没有发现可识别的节点"] };
  if (metrics.likelyMarkdownList) return { kind: "text", confidence: 0.98, reasons: ["检测到 Markdown 列表样式，而不是图连接线"] };
  if (metrics.edgeCount > 0) return {
    kind: "diagram",
    confidence: metrics.maxEdgeConfidence || 0.9,
    reasons: ["已恢复节点之间的连接关系"]
  };
  if (metrics.verticalConnectorCellCount >= 2 && metrics.nodeCount >= 2) return {
    kind: "diagram",
    confidence: 0.82,
    reasons: ["发现重复的纵向连接结构和多个节点"]
  };
  const hasDiagramEvidence = metrics.arrowCount > 0 || metrics.connectorComponentCount > 0 || metrics.boxCount > 0;
  if (mode === "lenient" && metrics.nodeCount >= 2 && hasDiagramEvidence) return {
    kind: "maybe",
    confidence: 0.58,
    reasons: ["发现图形符号和多个节点，但没有恢复出连接关系"]
  };
  if (metrics.boxCount > 0 && metrics.nodeCount >= 2) return { kind: "maybe", confidence: 0.55, reasons: ["发现多个节点，但没有连接关系"] };
  return {
    kind: "text",
    confidence: 0.96,
    reasons: [hasDiagramEvidence ? "连接符号没有形成节点之间的关系" : "缺少箭头、连接线或可识别的图结构"]
  };
}

export function classifyDiagram(analysis: ParseAnalysis, options?: ParseOptions): DiagramClassification;
export function classifyDiagram(tokens: Token[], options?: ParseOptions, diagram?: Diagram): DiagramClassification;
export function classifyDiagram(input: ParseAnalysis | Token[], options: ParseOptions = {}, diagram?: Diagram): DiagramClassification {
  return classifyAnalysis(Array.isArray(input) ? legacyAnalysis(input, diagram) : input, options);
}
