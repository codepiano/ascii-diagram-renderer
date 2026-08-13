const fnv1a = (value: string) => {
  let hash = 0x811c9dc5;
  for (const character of value) {
    hash ^= character.codePointAt(0)!;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
};

/** Stable for the same semantic item even when unrelated items are inserted before it. */
export function createStableId(namespace: string, parts: Array<string | number>, occurrence = 1): string {
  return `${namespace}-${fnv1a(parts.join("\u001f"))}-${occurrence}`;
}
