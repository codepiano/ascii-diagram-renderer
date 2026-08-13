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
  outputs: readonly string[];
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
  { id: "multiline-node", outputs: ["multiline-node"], phase: "node", profile: "structural", minimumConfidence: 0.6, recognize: recognizeMultilineNodes },
  { id: "cycle", outputs: ["cycle"], phase: "edge", profile: "structural", minimumConfidence: 0.6, recognize: recognizeCycles },
  { id: "arrow-branch", outputs: ["arrow-branch"], phase: "edge", profile: "structural", minimumConfidence: 0.6, recognize: recognizeArrowBranches },
  { id: "arrow", outputs: ["arrow"], phase: "edge", profile: "structural", minimumConfidence: 0.6, recognize: recognizeArrows },
  { id: "line-branch", outputs: ["line-branch"], phase: "edge", profile: "structural", minimumConfidence: 0.6, recognize: recognizeLineBranches },
  { id: "line-edge", outputs: ["vertical-line", "horizontal-line"], phase: "edge", profile: "structural", minimumConfidence: 0.6, recognize: recognizeLineEdges },
  { id: "examples", outputs: ["examples"], phase: "group", profile: "llm-common", minimumConfidence: 0.6, recognize: recognizeExampleGroups }
];

const enabled = (definition: RecognizerDefinition, semanticProfile: SemanticProfile) =>
  definition.profile === "structural" || definition.profile === semanticProfile;
const withPolicy = <T>(definition: DefinitionBase, candidates: RecognitionCandidate<T>[]) => candidates.map(candidate => {
  if (!definition.outputs.includes(candidate.recognizer)) {
    throw new Error(`Recognizer ${definition.id} emitted candidate for ${candidate.recognizer}.`);
  }
  const value = candidate.value as Record<string, unknown> | null;
  const validValue = definition.phase === "node"
    ? Boolean(value && "merge" in value)
    : definition.phase === "edge"
      ? Boolean(value && Array.isArray(value.edges))
      : Boolean(value && Array.isArray(value.members));
  if (!validValue) throw new Error(`Recognizer ${definition.id} emitted an invalid ${definition.phase} candidate.`);
  return { ...candidate, minimumConfidence: definition.minimumConfidence };
});

export class RecognizerRunner {
  constructor(readonly definitions: readonly RecognizerDefinition[]) {
    const ids = definitions.map(definition => definition.id);
    if (new Set(ids).size !== ids.length) throw new Error("Recognizer ids must be unique.");
    if (definitions.some(definition => definition.minimumConfidence < 0 || definition.minimumConfidence > 1)) {
      throw new Error("Recognizer minimum confidence must be between 0 and 1.");
    }
    if (definitions.some(definition => !definition.outputs.length || new Set(definition.outputs).size !== definition.outputs.length)) {
      throw new Error("Recognizer outputs must be a non-empty unique list.");
    }
  }

  runNodes(nodes: DiagramNode[], primitives: PrimitiveDocument, semanticProfile: SemanticProfile) {
    return this.definitions
    .filter((definition): definition is NodeRecognizerDefinition => definition.phase === "node" && enabled(definition, semanticProfile))
    .flatMap(definition => withPolicy(definition, definition.recognize(nodes, primitives)));
  }

  runEdges(context: TopologyContext, semanticProfile: SemanticProfile) {
    return this.definitions
    .filter((definition): definition is EdgeRecognizerDefinition => definition.phase === "edge" && enabled(definition, semanticProfile))
    .flatMap(definition => withPolicy(definition, definition.recognize(context)));
  }

  runGroups(context: TopologyContext, semanticProfile: SemanticProfile) {
    return this.definitions
    .filter((definition): definition is GroupRecognizerDefinition => definition.phase === "group" && enabled(definition, semanticProfile))
    .flatMap(definition => withPolicy(definition, definition.recognize(context)));
  }
}

export const defaultRecognizerRunner = new RecognizerRunner(recognizerRegistry);
