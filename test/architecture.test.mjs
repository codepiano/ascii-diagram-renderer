import test from "node:test";
import assert from "node:assert/strict";
import { classifyDiagram, parseAscii } from "../dist/core.js";
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
  const [component] = graph.components();
  assert.equal(component.cells.length, 5);
  assert.deepEqual(component.junctions, [{ row: 1, col: 1 }]);
  assert.equal(graph.paths(component).length, 4);
});

test("glyph graph connects loose ASCII trunks through implicit junctions", () => {
  const source = new SourceDocument(" |\n---\n | ");
  const graph = new GlyphGraph(source);
  assert.equal(graph.components().length, 1);
  assert.deepEqual(graph.components()[0].junctions, [{ row: 1, col: 1 }]);
  assert.equal(graph.paths(graph.components()[0]).length, 4);
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

test("parse analysis explains accepted and conflicting topology candidates", () => {
  const input = "               Text\n                 │\n        ┌────────┴────────┐\n        ▼                 ▼\n      EVOKE             INVOKE\n        │                 │\n lexical/grammar       interpreter\n explicitly indexes   supplies frame\n a frame              for coherence\n        │                 │\n        └────────┬────────┘\n                 ▼\n           Envisionment";
  const parsed = parseAscii(input);
  assert.ok(parsed.analysis.accepted.some(item => item.phase === "node" && item.recognizer === "multiline-node"));
  assert.ok(parsed.analysis.accepted.some(item => item.phase === "edge" && item.recognizer === "arrow-branch"));
  assert.ok(parsed.analysis.rejected.some(item => item.recognizer === "arrow" && item.reason === "conflict" && item.conflictsWith));
  assert.deepEqual(parsed.analysis.unconsumedEvidence, []);
});

test("low-confidence semantic guesses stay visible without changing Diagram v1", () => {
  const parsed = parseAscii("A\n|\nB\n\nThis is an ordinary explanatory note.\nIt continues as prose on the next line.");
  assert.deepEqual(parsed.diagram.groups, []);
  assert.ok(parsed.analysis.rejected.some(item => item.recognizer === "examples" && item.reason === "low-confidence"));
  assert.ok(parsed.analysis.diagnostics.some(diagnostic => diagnostic.code === "LOW_CONFIDENCE_INTERPRETATION"));
});

test("classification consumes ParseAnalysis directly", () => {
  const analysis = parseAscii("A\n---\nB", { detection: "lenient" }).analysis;
  assert.equal(classifyDiagram(analysis, { detection: "strict" }).kind, "text");
  assert.equal(classifyDiagram(analysis, { detection: "lenient" }).kind, "maybe");
});
