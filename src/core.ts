export * from "./types.js";
export { CharacterGrid } from "./grid.js";
export { tokenize } from "./tokenizer.js";
export { recoverTopology } from "./topology.js";
export { classifyDiagram } from "./classifier.js";

import { CharacterGrid } from "./grid.js";
import { GlyphGraph } from "./glyph-graph.js";
import { tokenize } from "./tokenizer.js";
import { recoverTopologyWithAnalysis } from "./topology.js";
import { classifyDiagram } from "./classifier.js";
import type { ParseOptions } from "./types.js";

function parse(input: string, options: ParseOptions) {
  const grid = new CharacterGrid(input);
  const glyphs = new GlyphGraph(grid);
  const tokens = tokenize(grid, glyphs);
  const { diagram, diagramV2, analysis } = recoverTopologyWithAnalysis(tokens, { lines: grid.lines, width: grid.width, height: grid.height }, glyphs);
  const classification = classifyDiagram(analysis, options);
  return { grid, tokens, diagram, diagramV2, classification, analysis };
}

export function parseAscii(input: string, options: ParseOptions = {}) {
  const { diagramV2: _diagramV2, ...result } = parse(input, options);
  return result;
}

export function parseAsciiV2(input: string, options: ParseOptions = {}) {
  const { diagram: _diagramV1, diagramV2: diagram, ...result } = parse(input, options);
  return { ...result, diagram };
}
