export * from "./types.js";
export { classifyDiagram } from "./classifier.js";
export { validateDiagram, validatePrimitiveDocument, ParseInvariantError } from "./validation.js";

import { CharacterGrid } from "./grid.js";
import { GlyphGraph } from "./glyph-graph.js";
import { extractPrimitives } from "./primitives.js";
import { recoverTopologyWithAnalysis } from "./topology.js";
import { classifyDiagram } from "./classifier.js";
import { assertValidParseArtifacts } from "./validation.js";
import type { ParseOptions } from "./types.js";

export function parseAscii(input: string, options: ParseOptions = {}) {
  const grid = new CharacterGrid(input);
  const glyphs = new GlyphGraph(grid);
  const primitives = extractPrimitives(grid, glyphs);
  const { diagram, analysis } = recoverTopologyWithAnalysis(primitives, { lines: grid.lines, width: grid.width, height: grid.height }, options);
  assertValidParseArtifacts(primitives, diagram);
  const classification = classifyDiagram(analysis, options);
  return { primitives, diagram, classification, analysis };
}
