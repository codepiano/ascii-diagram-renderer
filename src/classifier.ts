import type { Diagram, DiagramClassification, ParseOptions, Token } from "./types.js";

export function classifyDiagram(tokens: Token[], options: ParseOptions = {}, diagram?: Diagram): DiagramClassification {
  const mode = options.detection ?? "strict";
  const nodes = tokens.filter(token => token.kind === "text" || token.kind === "box").length;
  const arrows = tokens.filter(token => token.kind === "arrow").length;
  const lineTokens = tokens.filter((token): token is Extract<Token, { kind: "line" }> => token.kind === "line");
  const lines = lineTokens.length;
  const boxes = tokens.filter(token => token.kind === "box").length;
  const recoveredEdges = diagram?.edges.length ?? 0;

  if (nodes === 0) return { kind: "text", confidence: 1, reasons: ["没有发现可识别的节点"] };
  const likelyMarkdownList = arrows === 0 && lines > 0 && lineTokens.every(token => token.orientation === "horizontal" && token.points.length === 1);
  if (likelyMarkdownList) return { kind: "text", confidence: 0.98, reasons: ["检测到 Markdown 列表样式，而不是图连接线"] };
  if (recoveredEdges > 0) return { kind: "diagram", confidence: arrows > 0 ? 0.98 : 0.92, reasons: ["已恢复节点之间的连接关系"] };
  const verticalCells = lineTokens.filter(token => token.orientation === "vertical").length;
  if (verticalCells >= 2 && nodes >= 2) return { kind: "diagram", confidence: 0.82, reasons: ["发现重复的纵向连接结构和多个节点"] };
  if (!diagram && arrows > 0 && nodes >= 2) return { kind: "diagram", confidence: 0.9, reasons: ["发现箭头和至少两个节点，但尚未提供拓扑结果"] };
  if (!diagram && boxes > 0 && lines > 0 && nodes >= 2) return { kind: "diagram", confidence: 0.86, reasons: ["发现盒节点、连接线和多个节点，但尚未提供拓扑结果"] };
  if (mode === "lenient" && nodes >= 2 && (arrows > 0 || lines > 0 || boxes > 0)) return { kind: "maybe", confidence: 0.58, reasons: ["发现图形符号和多个节点，但没有恢复出连接关系"] };
  if (boxes > 0 && nodes >= 2) return { kind: "maybe", confidence: 0.55, reasons: ["发现多个节点，但没有连接关系"] };
  return { kind: "text", confidence: 0.96, reasons: [lines > 0 ? "连接符号没有形成节点之间的关系" : "缺少箭头、连接线或可识别的图结构"] };
}
