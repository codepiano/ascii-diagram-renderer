import test from "node:test";
import assert from "node:assert/strict";
import { parseAscii } from "../dist/core.js";
import { GlyphGraph } from "../dist/glyph-graph.js";
import { resolveCandidates } from "../dist/recognition.js";
import { SourceDocument } from "../dist/source.js";

test("glyph graph records four-way junction connectivity", () => {
  const source = new SourceDocument(" │\n─┼─\n │");
  const graph = new GlyphGraph(source);
  assert.deepEqual(
    graph.neighbors({ row: 1, col: 1 }).map(cell => cell.point),
    [{ row: 0, col: 1 }, { row: 1, col: 2 }, { row: 2, col: 1 }, { row: 1, col: 0 }]
  );
});

test("candidate resolution does not depend on recognizer registration order", () => {
  const weak = { id: "weak", recognizer: "weak", priority: 10, confidence: 0.9, consumes: ["glyph:1"], evidence: ["glyph:1"], value: "weak" };
  const strong = { id: "strong", recognizer: "strong", priority: 20, confidence: 0.8, consumes: ["glyph:1"], evidence: ["glyph:1"], value: "strong" };
  assert.deepEqual(resolveCandidates([weak, strong]).accepted.map(candidate => candidate.id), ["strong"]);
  assert.deepEqual(resolveCandidates([strong, weak]).accepted.map(candidate => candidate.id), ["strong"]);
});

test("semantic topology is stable under indentation and CRLF normalization", () => {
  const original = parseAscii("A\n|\nv\nB").diagram;
  const shifted = parseAscii("    A\r\n    |\r\n    v\r\n    B").diagram;
  const semantics = diagram => ({
    nodes: diagram.nodes.map(node => node.label),
    edges: diagram.edges.map(edge => [diagram.nodes.find(node => node.id === edge.source)?.label, diagram.nodes.find(node => node.id === edge.target)?.label])
  });
  assert.deepEqual(semantics(shifted), semantics(original));
});
