export type RecognitionCandidate<T> = {
  id: string;
  recognizer: string;
  priority: number;
  confidence: number;
  consumes: string[];
  evidence: string[];
  value: T;
};

export type RecognitionResolution<T> = {
  accepted: RecognitionCandidate<T>[];
  rejected: Array<{ candidate: RecognitionCandidate<T>; conflictsWith: string }>;
};

/** Selects the strongest non-conflicting interpretations independent of registration order. */
export function resolveCandidates<T>(candidates: RecognitionCandidate<T>[]): RecognitionResolution<T> {
  const accepted: RecognitionCandidate<T>[] = [];
  const rejected: RecognitionResolution<T>["rejected"] = [];
  const owners = new Map<string, string>();
  const ordered = [...candidates].sort((a, b) =>
    b.priority - a.priority || b.confidence - a.confidence || a.id.localeCompare(b.id)
  );
  for (const candidate of ordered) {
    const conflict = candidate.consumes.map(key => owners.get(key)).find(Boolean);
    if (conflict) {
      rejected.push({ candidate, conflictsWith: conflict });
      continue;
    }
    accepted.push(candidate);
    for (const key of candidate.consumes) owners.set(key, candidate.id);
  }
  return { accepted, rejected };
}
