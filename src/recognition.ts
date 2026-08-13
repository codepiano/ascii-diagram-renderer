export type RecognitionCandidate<T> = {
  id: string;
  recognizer: string;
  priority: number;
  confidence: number;
  minimumConfidence?: number;
  consumes: string[];
  evidence: string[];
  value: T;
};

export type RecognitionResolution<T> = {
  accepted: RecognitionCandidate<T>[];
  rejected: Array<{ candidate: RecognitionCandidate<T>; reason: "conflict" | "low-confidence"; conflictsWith?: string }>;
};

/** Selects the strongest non-conflicting interpretations independent of registration order. */
export function resolveCandidates<T>(candidates: RecognitionCandidate<T>[], options: { minimumConfidence?: number } = {}): RecognitionResolution<T> {
  const accepted: RecognitionCandidate<T>[] = [];
  const rejected: RecognitionResolution<T>["rejected"] = [];
  const owners = new Map<string, string>();
  const ordered = [...candidates].sort((a, b) =>
    b.priority - a.priority || b.confidence - a.confidence || a.id.localeCompare(b.id)
  );
  for (const candidate of ordered) {
    if (candidate.confidence < (candidate.minimumConfidence ?? options.minimumConfidence ?? 0)) {
      rejected.push({ candidate, reason: "low-confidence" });
      continue;
    }
    const conflict = candidate.consumes.map(key => owners.get(key)).find(Boolean);
    if (conflict) {
      rejected.push({ candidate, reason: "conflict", conflictsWith: conflict });
      continue;
    }
    accepted.push(candidate);
    for (const key of candidate.consumes) owners.set(key, candidate.id);
  }
  return { accepted, rejected };
}

export function summarizeResolution<T>(phase: RecognitionPhase, resolution: RecognitionResolution<T>): { accepted: RecognitionSummary[]; rejected: RejectedRecognitionSummary[] } {
  return {
    accepted: resolution.accepted.map(candidate => ({
      id: candidate.id, phase, recognizer: candidate.recognizer, confidence: candidate.confidence,
      evidence: candidate.evidence, consumes: candidate.consumes
    })),
    rejected: resolution.rejected.map(({ candidate, reason, conflictsWith }) => ({
      id: candidate.id, phase, recognizer: candidate.recognizer, confidence: candidate.confidence,
      evidence: candidate.evidence, consumes: candidate.consumes, reason,
      ...(conflictsWith ? { conflictsWith } : {})
    }))
  };
}
import type { RecognitionPhase, RecognitionSummary, RejectedRecognitionSummary } from "./types.js";
