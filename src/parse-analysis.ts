import type { GlyphGraph } from "./glyph-graph.js";
import type { Diagnostic, ParseAnalysis, RecognitionSummary, RejectedRecognitionSummary, Token } from "./types.js";

export function createParseAnalysis(input: {
  tokens: Token[];
  glyphs: GlyphGraph;
  nodeCount: number;
  edgeCount: number;
  groupCount: number;
  accepted: RecognitionSummary[];
  rejected: RejectedRecognitionSummary[];
  diagnostics: Diagnostic[];
}): ParseAnalysis {
  const { tokens, glyphs, accepted, rejected, diagnostics } = input;
  const boxes = tokens.filter((token): token is Extract<Token, { kind: "box" }> => token.kind === "box");
  const meaningfulComponents = glyphs.components().filter(component => !boxes.some(box => component.cells.every(cell =>
    cell.point.row >= box.bounds.top && cell.point.row <= box.bounds.bottom && cell.point.col >= box.bounds.left && cell.point.col <= box.bounds.right
  )));
  const evidenceUniverse = [
    ...tokens.flatMap((token, index) => token.kind === "arrow" ? [`token:${index}`] : []),
    ...meaningfulComponents.map(component => component.id)
  ];
  const consumed = new Set(accepted.flatMap(item => item.consumes));
  const unconsumedEvidence = evidenceUniverse.filter(key => !consumed.has(key));
  const arrows = tokens.filter(token => token.kind === "arrow");
  const lineTokens = tokens.filter((token): token is Extract<Token, { kind: "line" }> => token.kind === "line");
  return {
    accepted,
    rejected,
    unconsumedEvidence,
    metrics: {
      nodeCount: input.nodeCount,
      edgeCount: input.edgeCount,
      groupCount: input.groupCount,
      arrowCount: arrows.length,
      unresolvedArrowCount: tokens.filter((token, index) => token.kind === "arrow" && unconsumedEvidence.includes(`token:${index}`)).length,
      boxCount: boxes.length,
      connectorComponentCount: meaningfulComponents.length,
      verticalConnectorCellCount: meaningfulComponents.flatMap(component => component.cells).filter(cell => cell.ports.has("north") && cell.ports.has("south")).length,
      likelyMarkdownList: arrows.length === 0 && lineTokens.length > 0 && lineTokens.every(token => token.orientation === "horizontal" && token.points.length === 1),
      maxEdgeConfidence: Math.max(0, ...accepted.filter(item => item.phase === "edge").map(item => item.confidence))
    },
    diagnostics: [
      ...diagnostics,
      ...rejected.filter(item => item.reason === "low-confidence").map(item => ({
        code: "LOW_CONFIDENCE_INTERPRETATION",
        message: `${item.recognizer} produced a low-confidence interpretation that was not applied.`,
        severity: "info" as const
      }))
    ]
  };
}
