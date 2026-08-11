import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseAscii } from "../dist/core.js";
import { renderSvg } from "../dist/svg.js";

const caseDir = join(dirname(fileURLToPath(import.meta.url)), "cases");
const files = readdirSync(caseDir).filter(file => /^\d+-.*\.json$/.test(file)).sort();

for (const file of files) {
  const fixture = JSON.parse(readFileSync(join(caseDir, file), "utf8"));
  test(`regression: ${fixture.name}`, () => {
    const parsed = parseAscii(fixture.input);
    const diagram = parsed.diagram;
    const expect = fixture.expect ?? {};
    if (expect.classification) assert.equal(parsed.classification.kind, expect.classification);
    assert.deepEqual(diagram.nodes.map(node => node.label), expect.nodeLabels ?? diagram.nodes.map(node => node.label));
    assert.deepEqual(diagram.nodes.map(node => node.shape), expect.nodeShapes ?? diagram.nodes.map(node => node.shape));
    const labels = new Map(diagram.nodes.map(node => [node.id, node.label]));
    const edges = diagram.edges.map(edge => [labels.get(edge.source), labels.get(edge.target)]);
    assert.deepEqual(edges, expect.edges ?? edges);
    const edgeLabels = diagram.edges.map(edge => edge.label);
    assert.deepEqual(edgeLabels, expect.edgeLabels ?? edgeLabels);
    const groups = diagram.groups.map(group => ({ kind: group.kind, parent: labels.get(group.parent), members: group.members.map(id => labels.get(id)) }));
    assert.deepEqual(groups, expect.groups ?? groups);
    assert.deepEqual(parsed.tokens.map(token => token.kind), expect.tokenKinds ?? parsed.tokens.map(token => token.kind));
    assert.equal(diagram.diagnostics.length, expect.diagnostics ?? diagram.diagnostics.length);
    if (expect.svg) {
      const svg = renderSvg(diagram, fixture.options);
      for (const fragment of expect.svg) assert.ok(svg.includes(fragment), `${file}: SVG does not contain ${fragment}`);
    }
  });
}
