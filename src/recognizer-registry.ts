import type { RecognitionCandidate } from "./recognition.js";
import {
  recognizeArrows,
  recognizeArrowBranches,
  recognizeCycles,
  recognizeExampleGroups,
  recognizeLineBranches,
  recognizeLineEdges,
  recognizeMultilineNodes,
  type EdgeInterpretation,
  type GroupInterpretation,
  type NodeInterpretation,
  type TopologyContext
} from "./topology-recognizers.js";
import type { DiagramNode, PrimitiveDocument, RecognitionPhase, SemanticProfile } from "./types.js";

type RecognizerProfile = "structural" | Exclude<SemanticProfile, "none">;
type DefinitionBase = {
  id: string;
  phase: RecognitionPhase;
  profile: RecognizerProfile;
  minimumConfidence: number;
};
export type NodeRecognizerDefinition = DefinitionBase & {
  phase: "node";
  recognize(nodes: DiagramNode[], primitives: PrimitiveDocument): RecognitionCandidate<NodeInterpretation>[];
};
export type EdgeRecognizerDefinition = DefinitionBase & {
  phase: "edge";
  recognize(context: TopologyContext): RecognitionCandidate<EdgeInterpretation>[];
};
export type GroupRecognizerDefinition = DefinitionBase & {
  phase: "group";
  recognize(context: TopologyContext): RecognitionCandidate<GroupInterpretation>[];
};
export type RecognizerDefinition = NodeRecognizerDefinition | EdgeRecognizerDefinition | GroupRecognizerDefinition;

/** The parser's extension inventory. Topology orchestration depends only on phases, not recognizer names. */
export const recognizerRegistry: readonly RecognizerDefinition[] = [
  { id: "multiline-node", phase: "node", profile: "structural", minimumConfidence: 0.6, recognize: recognizeMultilineNodes },
  { id: "cycle", phase: "edge", profile: "structural", minimumConfidence: 0.6, recognize: recognizeCycles },
  { id: "arrow-branch", phase: "edge", profile: "structural", minimumConfidence: 0.6, recognize: recognizeArrowBranches },
  { id: "arrow", phase: "edge", profile: "structural", minimumConfidence: 0.6, recognize: recognizeArrows },
  { id: "line-branch", phase: "edge", profile: "structural", minimumConfidence: 0.6, recognize: recognizeLineBranches },
  { id: "line-edge", phase: "edge", profile: "structural", minimumConfidence: 0.6, recognize: recognizeLineEdges },
  { id: "examples", phase: "group", profile: "llm-common", minimumConfidence: 0.6, recognize: recognizeExampleGroups }
];

const enabled = (definition: RecognizerDefinition, semanticProfile: SemanticProfile) =>
  definition.profile === "structural" || definition.profile === semanticProfile;
const withThreshold = <T>(definition: DefinitionBase, candidates: RecognitionCandidate<T>[]) =>
  candidates.map(candidate => ({ ...candidate, minimumConfidence: definition.minimumConfidence }));

export function runNodeRecognizers(nodes: DiagramNode[], primitives: PrimitiveDocument, semanticProfile: SemanticProfile) {
  return recognizerRegistry
    .filter((definition): definition is NodeRecognizerDefinition => definition.phase === "node" && enabled(definition, semanticProfile))
    .flatMap(definition => withThreshold(definition, definition.recognize(nodes, primitives)));
}

export function runEdgeRecognizers(context: TopologyContext, semanticProfile: SemanticProfile) {
  return recognizerRegistry
    .filter((definition): definition is EdgeRecognizerDefinition => definition.phase === "edge" && enabled(definition, semanticProfile))
    .flatMap(definition => withThreshold(definition, definition.recognize(context)));
}

export function runGroupRecognizers(context: TopologyContext, semanticProfile: SemanticProfile) {
  return recognizerRegistry
    .filter((definition): definition is GroupRecognizerDefinition => definition.phase === "group" && enabled(definition, semanticProfile))
    .flatMap(definition => withThreshold(definition, definition.recognize(context)));
}
