import test from "node:test";
import assert from "node:assert/strict";
import { parseAscii, validateDiagram, validateNodeRegions, validatePrimitiveDocument } from "../dist/core.js";
import { CharacterGrid } from "../dist/grid.js";
import { GlyphGraph } from "../dist/glyph-graph.js";
import { extractPrimitives } from "../dist/primitives.js";
import { RecognizerRunner, recognizerRegistry } from "../dist/recognizer-registry.js";
import { recoverTopologyWithAnalysis } from "../dist/topology.js";

const semantics = diagram => {
  const labels = new Map(diagram.nodes.map(node => [node.id, node.label]));
  return {
    nodes: diagram.nodes.map(node => [node.label, node.shape]),
    edges: diagram.edges.map(edge => [
      labels.get(edge.source), labels.get(edge.target), edge.direction,
      edge.markerEnd, edge.geometry.sourcePort, edge.geometry.targetPort,
      edge.label?.text
    ]),
    groups: diagram.groups.map(group => [
      group.kind, group.parent ? labels.get(group.parent) : undefined,
      group.members.map(member => labels.get(member))
    ]),
    diagnostics: diagram.diagnostics.map(diagnostic => diagnostic.code)
  };
};

const whitespaceVariants = input => [
  input.replaceAll("\n", "\r\n"),
  input.split("\n").map(line => `    ${line}`).join("\n"),
  input.split("\n").map((line, index) => `${line}${" ".repeat(index % 4)}`).join("\n"),
  `\n\n${input}\n\n`
];

test("whitespace and newline transformations preserve recovered semantics", () => {
  const diagrams = [
    "World State\n    |\n    v\nObservation\n    |\n    v\nDecision",
    "     Root\n      |\n  ---------\n  |   |   |\n  A   B   C",
    "              COMMERCIAL EVENT\n\n          ┌──────── Goods ────────┐\n          │                       ↓\n       Seller                   Buyer\n          ↑                       │\n          └──────── Money ────────┘"
  ];
  for (const input of diagrams) {
    const expected = semantics(parseAscii(input).diagram);
    for (const variant of whitespaceVariants(input)) {
      assert.deepEqual(semantics(parseAscii(variant).diagram), expected);
    }
  }
});

test("equivalent ASCII and Unicode connectors preserve semantics", () => {
  const ascii = parseAscii("Input\n  |\n  v\nOutput").diagram;
  const unicode = parseAscii("Input\n  │\n  ▼\nOutput").diagram;
  assert.deepEqual(semantics(unicode), semantics(ascii));

  const asciiHorizontal = parseAscii("Input -> Output").diagram;
  const unicodeHorizontal = parseAscii("Input → Output").diagram;
  assert.deepEqual(semantics(unicodeHorizontal), semantics(asciiHorizontal));

  assert.deepEqual(parseAscii("A < B").diagram.nodes.map(node => node.label), ["A < B"]);
});

test("TextRuns grow into conservative multiline node regions", () => {
  const columns = parseAscii("  |             |\nalpha one     beta one\nalpha two     beta two\n  |             |");
  assert.deepEqual(columns.regions.map(region => region.label), ["alpha one\nalpha two", "beta one\nbeta two"]);
  assert.ok(columns.regions.every(region => region.runIds.length === 2));
  assert.ok(columns.diagram.nodes.every(node => Array.isArray(node.metadata?.runIds)));
  assert.ok(columns.analysis.accepted.filter(item => item.recognizer === "multiline-region").length === 2);
  assert.ok(columns.analysis.rejected.filter(item => item.recognizer === "single-line-region" && item.reason === "conflict").length === 4);

  const prose = parseAscii("This is an ordinary explanatory note.\nIt continues as prose on the next line.");
  assert.equal(prose.regions.length, 2);
  assert.ok(prose.analysis.rejected.some(item => item.recognizer === "multiline-region" && item.reason === "low-confidence"));

  const barrier = parseAscii("alpha\n-----\nbeta");
  assert.deepEqual(barrier.regions.map(region => region.label), ["alpha", "beta"]);
  assert.equal(barrier.analysis.accepted.some(item => item.recognizer === "multiline-region"), false);

  const wrappedList = parseAscii([
    "[Models 思考与沟通工具]",
    "上下文图 / 概念模型 / 场景 / 目标模型 /",
    "实例化规格 / 形式化属性"
  ].join("\n"));
  assert.deepEqual(wrappedList.regions.map(region => region.label), [
    "[Models 思考与沟通工具]\n上下文图 / 概念模型 / 场景 / 目标模型 /\n实例化规格 / 形式化属性"
  ]);

  const processTitle = parseAscii("[Process 需求工程过程]\n启动 -> 探索 -> 决策");
  assert.deepEqual(processTitle.regions.map(region => region.label), [
    "[Process 需求工程过程]", "启动", "探索", "决策"
  ]);
});

const recoverWith = (input, runner) => {
  const grid = new CharacterGrid(input);
  const glyphs = new GlyphGraph(grid);
  const primitives = extractPrimitives(grid, glyphs);
  return recoverTopologyWithAnalysis(
    primitives,
    { lines: grid.lines, width: grid.width, height: grid.height },
    {},
    runner
  ).diagram;
};

test("recognizer registry order does not affect topology", () => {
  const input = "               Text\n                 │\n        ┌────────┴────────┐\n        ▼                 ▼\n      EVOKE             INVOKE\n        │                 │\n lexical/grammar       interpreter\n explicitly indexes   supplies frame\n a frame              for coherence\n        │                 │\n        └────────┬────────┘\n                 ▼\n           Envisionment";
  const forward = recoverWith(input, new RecognizerRunner(recognizerRegistry));
  const reverse = recoverWith(input, new RecognizerRunner([...recognizerRegistry].reverse()));
  assert.deepEqual(semantics(reverse), semantics(forward));
});

test("recognizer runner rejects invalid registry contracts", () => {
  assert.throws(() => new RecognizerRunner([recognizerRegistry[0], recognizerRegistry[0]]), /unique/);
  assert.throws(() => new RecognizerRunner([{ ...recognizerRegistry[0], minimumConfidence: 2 }]), /between 0 and 1/);

  const mismatched = new RecognizerRunner([{
    id: "declared", outputs: ["declared"], phase: "edge", profile: "structural", minimumConfidence: 0,
    recognize: () => [{
      id: "candidate", recognizer: "different", priority: 1, confidence: 1,
      consumes: [], evidence: [], value: { edges: [] }
    }]
  }]);
  assert.throws(() => mismatched.runEdges({ nodes: [], primitives: parseAscii("").primitives, source: { lines: [""], width: 0, height: 1 } }, "none"), /emitted candidate/);

  const wrongPhaseValue = new RecognizerRunner([{
    id: "edge", outputs: ["edge"], phase: "edge", profile: "structural", minimumConfidence: 0,
    recognize: () => [{
      id: "candidate", recognizer: "edge", priority: 1, confidence: 1,
      consumes: [], evidence: [], value: { members: [] }
    }]
  }]);
  assert.throws(() => wrongPhaseValue.runEdges({ nodes: [], primitives: parseAscii("").primitives, source: { lines: [""], width: 0, height: 1 } }, "none"), /invalid edge candidate/);
});

const random = (() => {
  let state = 0x6d2b79f5;
  return () => {
    state |= 0;
    state = state + 0x6d2b79f5 | 0;
    let value = Math.imul(state ^ state >>> 15, 1 | state);
    value = value + Math.imul(value ^ value >>> 7, 61 | value) ^ value;
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
})();
const alphabet = [" ", "A", "b", "中", "😀", "|", "-", "+", "/", "\\", "^", "v", "→", "←", "│", "─", "┼", "▼", "\t", "."];

test("deterministic random inputs never escape parser invariants", () => {
  for (let caseIndex = 0; caseIndex < 500; caseIndex++) {
    const height = Math.floor(random() * 12);
    const lines = [...Array(height)].map(() => {
      const width = Math.floor(random() * 36);
      return [...Array(width)].map(() => alphabet[Math.floor(random() * alphabet.length)]).join("");
    });
    const input = lines.join(random() < 0.5 ? "\n" : "\r\n");
    const parsed = parseAscii(input, { semanticProfile: random() < 0.5 ? "none" : "llm-common" });
    assert.deepEqual(validatePrimitiveDocument(parsed.primitives), [], `primitive invariant failure for fuzz case ${caseIndex}`);
    assert.deepEqual(validateNodeRegions(parsed.regions, parsed.primitives), [], `node region invariant failure for fuzz case ${caseIndex}`);
    assert.deepEqual(validateDiagram(parsed.diagram, parsed.primitives), [], `Diagram invariant failure for fuzz case ${caseIndex}`);
    assert.doesNotThrow(() => JSON.stringify(parsed));
  }
});
