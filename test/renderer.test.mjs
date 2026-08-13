import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseAscii, asciiToSvg } from "../dist/index.js";

test("recovers a vertical flow", () => {
  const result = parseAscii("World State\n    |\n    v\nObservation");
  assert.deepEqual(result.diagram.nodes.map(n => n.label), ["World State", "Observation"]);
  assert.equal(result.diagram.edges.length, 1);
  assert.equal(result.diagram.version, "2");
  assert.deepEqual(result.diagram.diagnostics, []);
  assert.equal(result.diagram.edges[0].source, result.diagram.nodes[0].id);
  assert.equal(result.diagram.edges[0].target, result.diagram.nodes[1].id);
});

test("core subpath is renderer independent", async () => {
  const core = await import("../dist/core.js");
  const result = core.parseAscii("A\n|\nv\nB");
  assert.equal(result.diagram.nodes.length, 2);
  assert.equal("tokenize" in core, false);
});

test("renders escaped labels as SVG text", () => {
  const svg = asciiToSvg("A < B\n|\nv\nC & D");
  assert.match(svg, /A &lt; B/);
  assert.match(svg, /C &amp; D/);
  assert.match(svg, /marker-end/);
});

test("unicode horizontal arrow reaches the target-side port", () => {
  const svg = asciiToSvg("Input → Output", { mode: "preserve" });
  assert.match(svg, /M 89 38 L 96 38" marker-end="url\(#arrow\)"/);
});

test("convenience SVG API does not render plain prose", () => {
  assert.equal(asciiToSvg("This is explanatory prose, not a diagram."), "");
});

test("preserve mode keeps a vertical source path straight", () => {
  const { diagram } = parseAscii("World State\n    |\n    v\nObservation\n    |\n    v\nDecision");
  const svg = asciiToSvg("World State\n    |\n    v\nObservation\n    |\n    v\nDecision", { mode: "preserve" });
  const paths = [...svg.matchAll(/<path class="edge" d="([^"]+)"/g)].map(match => match[1]);
  assert.equal(paths.length, diagram.edges.length);
  assert.equal(paths[1], "M 64.5 142 L 64.5 192");
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

test("examples group keeps member boxes separated", () => {
  const input = "LLM\n |\nFunction Calling\n |\n自己写各种adapter\n\nGitHub API\n数据库\n文件系统\nSlack";
  const svg = asciiToSvg(input, { mode: "preserve" });
  assert.match(svg, /class="group"/);
  assert.match(svg, /stroke-dasharray/);
  const textY = [...svg.matchAll(/<text x="[\d.]+" y="([\d.]+)"/g)].map(match => Number(match[1]));
  assert.ok(textY.length >= 7);
  assert.ok(textY.at(-1) - textY.at(-2) >= 40);
});

test("examples group centers on its parent while members stay left aligned", () => {
  const input = "LLM\n |\nFunction Calling\n |\n自己写各种adapter\n\nGitHub API\n数据库\n文件系统\nSlack";
  const svg = asciiToSvg(input, { mode: "preserve" });
  const parentCenter = Number(svg.match(/<text x="([\d.]+)" y="153"[^>]*>自己写各种adapter<\/text>/)?.[1]);
  const group = svg.match(/<g class="group"><rect x="(-?[\d.]+)" y="[\d.]+" width="([\d.]+)"/);
  assert.equal(Number(group?.[1]) + Number(group?.[2]) / 2, parentCenter);
  const nodeLefts = [...svg.matchAll(/data-node-id="[^"]+"><rect class="text-node" x="(-?[\d.]+)"/g)].map(match => Number(match[1]));
  const memberLefts = nodeLefts.slice(-4);
  assert.equal(memberLefts.length, 4);
  assert.ok(memberLefts.every(left => left === memberLefts[0]));
});

test("branch routes preserve the horizontal trunk", () => {
  const fixture = JSON.parse(readFileSync(fileURLToPath(new URL("./cases/11-tree-branch.json", import.meta.url)), "utf8"));
  const input = fixture.input;
  const svg = asciiToSvg(input, { mode: "preserve" });
  const expectedY = fixture.expect.render.trunkRow * 28 + 24 + 14;
  assert.match(svg, new RegExp(`L [\\d.]+ ${expectedY} L [\\d.]+ ${expectedY}`));
  assert.doesNotMatch(svg, /marker-end/);
  const rootCenter = svg.match(new RegExp(`<text x="([\\d.]+)" y="41"[^>]*>${fixture.expect.render.rootLabel}</text>`))?.[1];
  const expectedX = fixture.expect.render.rootCenterColumn * 9 + 24 + 4.5;
  assert.equal(rootCenter, String(expectedX));
});

test("cycle rails stay orthogonal when labels widen their nodes", () => {
  const input = "              COMMERCIAL EVENT\n\n          ┌──────── Goods ────────┐\n          │                       ↓\n       Seller                   Buyer\n          ↑                       │\n          └──────── Money ────────┘";
  const svg = asciiToSvg(input, { mode: "preserve" });
  const paths = [...svg.matchAll(/<path class="edge" d="([^"]+)"/g)].map(match => match[1]);
  assert.match(paths[0], /M 118\.5 136 L 118\.5 94 L 334\.5 94 L 334\.5 136/);
  assert.match(paths[1], /M 334\.5 170 L 334\.5 206 L 118\.5 206 L 118\.5 170/);
});
