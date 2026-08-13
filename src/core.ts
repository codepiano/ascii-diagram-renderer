export * from "./types.js";
export { CharacterGrid } from "./grid.js";
export { tokenize } from "./tokenizer.js";
export { recoverTopology } from "./topology.js";
export { classifyDiagram } from "./classifier.js";

import { CharacterGrid } from "./grid.js";
import { GlyphGraph } from "./glyph-graph.js";
import { tokenize } from "./tokenizer.js";
import { recoverTopology } from "./topology.js";
import { classifyDiagram } from "./classifier.js";
import type { ParseOptions } from "./types.js";

export function parseAscii(input: string, options: ParseOptions = {}) {
  const grid = new CharacterGrid(input);
  const glyphs = new GlyphGraph(grid);
  const tokens = tokenize(grid, glyphs);
  const diagram = recoverTopology(tokens, { lines: grid.lines, width: grid.width, height: grid.height }, glyphs);
  const classification = classifyDiagram(tokens, options, diagram);
  return { grid, tokens, diagram, classification };
}
