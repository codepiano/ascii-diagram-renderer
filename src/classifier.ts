import type { DiagramClassification, ParseOptions, Token } from "./types.js";

export function classifyDiagram(tokens: Token[], options: ParseOptions = {}): DiagramClassification {
  const mode = options.detection ?? "strict";
  const nodes = tokens.filter(token => token.kind === "text" || token.kind === "box").length;
  const arrows = tokens.filter(token => token.kind === "arrow").length;
  const lines = tokens.filter(token => token.kind === "line").length;
  const boxes = tokens.filter(token => token.kind === "box").length;
  const reasons: string[] = [];

  if (nodes === 0) return { kind: "text", confidence: 1, reasons: ["没有发现可识别的节点"] };
  if (arrows > 0 && nodes >= 2) return { kind: "diagram", confidence: 0.98, reasons: ["发现箭头和至少两个节点"] };
  if (boxes > 0 && lines > 0 && nodes >= 2) return { kind: "diagram", confidence: 0.94, reasons: ["发现盒节点、连接线和多个节点"] };
  const likelyMarkdownList = arrows === 0 && lines > 0 && tokens.filter(token => token.kind === "line").every(token => token.orientation === "horizontal" && token.points.length === 1);
  if (likelyMarkdownList) return { kind: "text", confidence: 0.98, reasons: ["检测到 Markdown 列表样式，而不是图连接线"] };
  if (lines > 0 && nodes >= 2) {
    reasons.push("发现连接线，但没有明确箭头");
    return { kind: mode === "lenient" ? "diagram" : "maybe", confidence: 0.7, reasons };
  }
  if (boxes > 0 && nodes >= 2) return { kind: "maybe", confidence: 0.55, reasons: ["发现多个节点，但没有连接关系"] };
  return { kind: "text", confidence: 0.96, reasons: ["缺少箭头、连接线或可识别的图结构"] };
}
