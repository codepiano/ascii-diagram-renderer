import type { Diagnostic, ParseAnalysis, PrimitiveDocument, RecognitionSummary, RejectedRecognitionSummary } from "./types.js";

export function createParseAnalysis(input: {
  primitives: PrimitiveDocument;
  nodeCount: number;
  edgeCount: number;
  groupCount: number;
  accepted: RecognitionSummary[];
  rejected: RejectedRecognitionSummary[];
  diagnostics: Diagnostic[];
}): ParseAnalysis {
  const { primitives, accepted, rejected, diagnostics } = input;
  const evidenceUniverse = [
    ...primitives.arrows.map(arrow => arrow.id),
    ...primitives.connectors.map(connector => connector.id)
  ];
  const consumed = new Set(accepted.flatMap(item => item.consumes));
  const unconsumedEvidence = evidenceUniverse.filter(key => !consumed.has(key));
  const arrows = primitives.arrows;
  return {
    accepted,
    rejected,
    unconsumedEvidence,
    metrics: {
      nodeCount: input.nodeCount,
      edgeCount: input.edgeCount,
      groupCount: input.groupCount,
      arrowCount: arrows.length,
      unresolvedArrowCount: arrows.filter(arrow => unconsumedEvidence.includes(arrow.id)).length,
      boxCount: primitives.boxes.length,
      connectorComponentCount: primitives.connectors.length,
      verticalConnectorCellCount: primitives.connectors.flatMap(component => component.cells).filter(cell => cell.ports.includes("north") && cell.ports.includes("south")).length,
      likelyMarkdownList: arrows.length === 0 && primitives.connectors.length > 0 && primitives.connectors.every(connector =>
        connector.cells.length === 1 &&
        connector.cells.every(cell =>
          (cell.ports.includes("east") || cell.ports.includes("west")) &&
          !cell.ports.includes("north") &&
          !cell.ports.includes("south")
        )
      ),
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
