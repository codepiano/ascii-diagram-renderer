import test from "node:test";
import assert from "node:assert/strict";
import { classifyDiagram, parseAscii, validateDiagram, validateNodeRegions, validatePrimitiveDocument } from "../dist/core.js";
import { GlyphGraph } from "../dist/glyph-graph.js";
import { resolveCandidates } from "../dist/recognition.js";
import { recognizerRegistry } from "../dist/recognizer-registry.js";
import { displayWidth, SourceDocument } from "../dist/source.js";
import { renderSvg } from "../dist/svg.js";

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

test("recognizer registry declares unique phase, profile, and confidence policy", () => {
  assert.equal(new Set(recognizerRegistry.map(definition => definition.id)).size, recognizerRegistry.length);
  assert.ok(recognizerRegistry.every(definition => ["node", "edge", "group"].includes(definition.phase)));
  assert.ok(recognizerRegistry.every(definition => ["structural", "llm-common"].includes(definition.profile)));
  assert.ok(recognizerRegistry.every(definition => definition.minimumConfidence >= 0 && definition.minimumConfidence <= 1));
  assert.ok(recognizerRegistry.every(definition => definition.outputs.length > 0));

  const resolution = resolveCandidates([{
    id: "below-own-threshold", recognizer: "test", priority: 1, confidence: 0.5,
    minimumConfidence: 0.6, consumes: [], evidence: [], value: null
  }], { minimumConfidence: 0 });
  assert.equal(resolution.rejected[0]?.reason, "low-confidence");
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
  assert.ok(parsed.analysis.accepted.some(item => item.phase === "node" && item.recognizer === "multiline-region"));
  assert.ok(parsed.analysis.accepted.some(item => item.phase === "edge" && item.recognizer === "arrow-branch"));
  assert.ok(parsed.analysis.rejected.some(item => item.recognizer === "arrow" && item.reason === "conflict" && item.conflictsWith));
  assert.deepEqual(parsed.analysis.unconsumedEvidence, []);
});

test("low-confidence semantic guesses stay visible without changing the Diagram", () => {
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

test("Diagram ids survive unrelated insertions", () => {
  const original = parseAscii("A → B").diagram;
  const withIntroduction = parseAscii("Introduction\n\nA → B").diagram;
  const originalIds = new Map(original.nodes.map(node => [node.label, node.id]));
  const insertedIds = new Map(withIntroduction.nodes.map(node => [node.label, node.id]));
  assert.equal(insertedIds.get("A"), originalIds.get("A"));
  assert.equal(insertedIds.get("B"), originalIds.get("B"));
  assert.equal(withIntroduction.edges[0].id, original.edges[0].id);
});

test("Diagram exposes generic ports and renders without recognizer-specific routes", () => {
  const diagram = parseAscii("A → B").diagram;
  assert.equal(diagram.version, "2");
  assert.equal(diagram.edges[0].geometry.sourcePort, "right");
  assert.equal(diagram.edges[0].geometry.targetPort, "left");
  assert.equal("sourceRoute" in diagram.edges[0], false);
  const svg = renderSvg(diagram, { mode: "preserve" });
  assert.match(svg, /marker-end/);
  assert.match(svg, new RegExp(`data-node-id="${diagram.nodes[0].id}"`));
});

test("parseAscii exposes serializable source primitives", () => {
  const input = "Root\n |\n---\n |\nLeaf";
  const parsed = parseAscii(input);

  assert.equal("tokens" in parsed, false);
  assert.equal(parsed.primitives.version, "1");
  assert.ok(parsed.primitives.items.length > 0);
  assert.equal(parsed.primitives.connectors.length, 1);
  assert.deepEqual(parsed.primitives.connectors[0].junctions, [{ row: 2, col: 1 }]);
  assert.ok(parsed.primitives.connectors[0].paths.length >= 3);
  assert.doesNotThrow(() => JSON.stringify(parsed.primitives));
  assert.ok(parsed.analysis.accepted.filter(item => item.phase === "edge").every(item =>
    item.evidence.some(id => id === parsed.primitives.connectors[0].id)
  ));
});

test("semantic profiles isolate domain conventions from structural parsing", () => {
  const input = "A\n|\nB\n\none\ntwo";
  const compatible = parseAscii(input);
  const structural = parseAscii(input, { semanticProfile: "none" });

  assert.equal(compatible.diagram.groups[0]?.kind, "examples");
  assert.deepEqual(structural.diagram.groups, []);
  assert.ok(structural.diagram.edges.length > 0);
  assert.equal(structural.analysis.accepted.some(item => item.recognizer === "examples"), false);
  assert.equal(structural.analysis.rejected.some(item => item.recognizer === "examples"), false);
});

test("public validators enforce primitive and Diagram invariants", () => {
  const parsed = parseAscii("A → B");
  assert.deepEqual(validatePrimitiveDocument(parsed.primitives), []);
  assert.deepEqual(validateNodeRegions(parsed.regions, parsed.primitives), []);
  assert.deepEqual(validateDiagram(parsed.diagram, parsed.primitives), []);

  const invalidDiagram = structuredClone(parsed.diagram);
  invalidDiagram.edges[0].target = "missing-node";
  invalidDiagram.edges[0].geometry.points = [invalidDiagram.edges[0].geometry.points[0]];
  invalidDiagram.nodes[1].id = invalidDiagram.nodes[0].id;
  assert.deepEqual(
    new Set(validateDiagram(invalidDiagram, parsed.primitives).map(issue => issue.code)),
    new Set(["DUPLICATE_DIAGRAM_ID", "MISSING_EDGE_TARGET", "INVALID_EDGE_GEOMETRY"])
  );

  const invalidPrimitives = structuredClone(parsed.primitives);
  invalidPrimitives.items.push(structuredClone(invalidPrimitives.items[0]));
  assert.ok(validatePrimitiveDocument(invalidPrimitives).some(issue => issue.code === "DUPLICATE_PRIMITIVE_ID"));

  const invalidRegions = structuredClone(parsed.regions);
  invalidRegions[0].runIds.push("missing-run");
  assert.ok(validateNodeRegions(invalidRegions, parsed.primitives).some(issue => issue.code === "MISSING_TEXT_RUN"));
});

test("display columns account for CJK and emoji in Diagram layout", () => {
  const source = new SourceDocument("中文 → B");
  assert.equal(displayWidth("A中文😀"), 7);
  assert.equal(displayWidth("👨‍👩‍👧‍👦"), 2);
  assert.equal(displayWidth("🇨🇳"), 2);
  assert.equal(source.displayColumn(0, 3), 5);
  const svg = renderSvg(parseAscii("中文 → B").diagram, { mode: "preserve" });
  assert.match(svg, /width="56"/);
});

test("Diagram generic geometry covers branches, cycles, labels, and groups", () => {
  const branch = parseAscii("     Root\n      |\n  ---------\n  |   |   |\n  A   B   C").diagram;
  assert.equal(branch.edges.length, 3);
  assert.ok(branch.edges.every(edge => edge.geometry.points.length >= 4));
  assert.doesNotMatch(JSON.stringify(branch), /sourceRoute/);
  assert.equal((renderSvg(branch).match(/<path class="edge"/g) ?? []).length, 3);

  const cycleInput = "              COMMERCIAL EVENT\n\n          ┌──────── Goods ────────┐\n          │                       ↓\n       Seller                   Buyer\n          ↑                       │\n          └──────── Money ────────┘";
  const cycle = parseAscii(cycleInput).diagram;
  assert.deepEqual(cycle.edges.map(edge => [edge.geometry.sourcePort, edge.geometry.targetPort]), [["top", "top"], ["bottom", "bottom"]]);
  assert.match(renderSvg(cycle), />Goods<|>Money</);

  const examples = parseAscii("A\n|\nB\n\none\ntwo").diagram;
  assert.equal(examples.groups[0].kind, "examples");
  assert.match(renderSvg(examples), /class="group"/);
});
