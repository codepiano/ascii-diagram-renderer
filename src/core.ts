export * from "./types.js";
export { classifyDiagram } from "./classifier.js";

import { CharacterGrid } from "./grid.js";
import { GlyphGraph } from "./glyph-graph.js";
import { extractPrimitives } from "./primitives.js";
import { tokenize } from "./tokenizer.js";
import { recoverTopologyWithAnalysis } from "./topology.js";
import { classifyDiagram } from "./classifier.js";
import type { ParseOptions } from "./types.js";

export function parseAscii(input: string, options: ParseOptions = {}) {
  const grid = new CharacterGrid(input);
  const glyphs = new GlyphGraph(grid);
  const tokens = tokenize(grid, glyphs);
  const primitives = extractPrimitives(tokens, glyphs);
  const { diagram, analysis } = recoverTopologyWithAnalysis(primitives, { lines: grid.lines, width: grid.width, height: grid.height }, options);
  const classification = classifyDiagram(analysis, options);
  return { primitives, diagram, classification, analysis };
}
