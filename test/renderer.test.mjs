import test from "node:test";
import assert from "node:assert/strict";
import { parseAscii, asciiToSvg } from "../dist/index.js";

test("recovers a vertical flow", () => {
  const result = parseAscii("World State\n    |\n    v\nObservation");
  assert.deepEqual(result.diagram.nodes.map(n => n.label), ["World State", "Observation"]);
  assert.equal(result.diagram.edges.length, 1);
  assert.equal(result.diagram.version, "1");
  assert.deepEqual(result.diagram.diagnostics, []);
  assert.deepEqual(result.diagram.edges[0], { ...result.diagram.edges[0], source: "n1", target: "n2" });
});

test("core subpath is renderer independent", async () => {
  const core = await import("../dist/core.js");
  const result = core.parseAscii("A\n|\nv\nB");
  assert.equal(result.diagram.nodes.length, 2);
  assert.equal(typeof core.tokenize, "function");
});

test("renders escaped labels as SVG text", () => {
  const svg = asciiToSvg("A < B\n|\nv\nC & D");
  assert.match(svg, /A &lt; B/);
  assert.match(svg, /C &amp; D/);
  assert.match(svg, /marker-end/);
});

test("convenience SVG API does not render plain prose", () => {
  assert.equal(asciiToSvg("This is explanatory prose, not a diagram."), "");
});

test("preserve mode keeps a vertical source path straight", () => {
  const { diagram } = parseAscii("World State\n    |\n    v\nObservation\n    |\n    v\nDecision");
  const svg = asciiToSvg("World State\n    |\n    v\nObservation\n    |\n    v\nDecision", { mode: "preserve" });
  const paths = [...svg.matchAll(/<path class="edge" d="([^"]+)"/g)].map(match => match[1]);
  assert.equal(paths.length, diagram.edges.length);
  assert.match(paths[1], /M 64\.5 142 L 64\.5 167 L 64\.5 167 L 64\.5 192/);
});

test("preserve mode centers differently sized connected nodes on the ASCII axis", () => {
  const svg = asciiToSvg("World State\n    |\n    v\nObservation\n    |\n    v\nDecision", { mode: "preserve" });
  const nodeCenters = [...svg.matchAll(/<text x="([\d.]+)"/g)].map(match => Number(match[1]));
  assert.deepEqual(nodeCenters, [64.5, 64.5, 64.5]);
});

test("recognizes boxed nodes", () => {
  const result = parseAscii("+---------+\n| Context |\n+---------+");
  assert.equal(result.diagram.nodes.length, 1);
  assert.equal(result.diagram.nodes[0].shape, "box");
  assert.equal(result.diagram.nodes[0].label, "Context");
});
