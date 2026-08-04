import { parseAscii } from "../dist/core.js";
import { renderSvg } from "../dist/svg.js";

const examples = {
  flow: `World State
    |
    v
Observation
    |
    v
Decision`,
  box: `+---------+
| Context |
+---------+
     |
     v
  Decision`,
  branch: `          +---------+
          | Context |
          +---------+
            /     \\
           /       \\
      Memory     Prompt
           \\       /
            \\     /
          Decision`
};

const input = document.querySelector("#ascii-input");
const preview = document.querySelector("#preview");
const irOutput = document.querySelector("#ir-output");
const tokenOutput = document.querySelector("#token-output");
const status = document.querySelector("#status");
const mode = document.querySelector("#mode-select");
const example = document.querySelector("#example-select");
let latestSvg = "";
let selectedCase = null;

function render() {
  try {
    const parsed = parseAscii(input.value);
    const shouldRender = parsed.classification.kind === "diagram";
    latestSvg = shouldRender ? renderSvg(parsed.diagram, { mode: mode.value }) : "";
    preview.replaceChildren();
    if (shouldRender) preview.innerHTML = latestSvg;
    else preview.textContent = `未渲染：${parsed.classification.reasons.join("；")}`;
    irOutput.textContent = JSON.stringify({ classification: parsed.classification, diagram: parsed.diagram }, null, 2);
    tokenOutput.replaceChildren(...parsed.tokens.map(token => {
      const item = document.createElement("span");
      item.className = `token token-${token.kind}`;
      item.textContent = token.kind === "text" ? `text: ${token.text}` : token.kind;
      return item;
    }));
    document.querySelector("#node-count").textContent = `${parsed.diagram.nodes.length} nodes · ${parsed.diagram.edges.length} edges`;
    document.querySelector("#token-count").textContent = `${parsed.tokens.length} tokens`;
    status.textContent = shouldRender
      ? (parsed.diagram.diagnostics.length ? parsed.diagram.diagnostics.map(d => d.message).join(" ") : `解析成功 · ${parsed.classification.kind}`)
      : `未识别为 Diagram · ${parsed.classification.reasons.join("；")}`;
    status.className = `status ${shouldRender && !parsed.diagram.diagnostics.length ? "success" : "warning"}`;
  } catch (error) {
    preview.textContent = "无法渲染此输入";
    status.textContent = error instanceof Error ? error.message : String(error);
    status.className = "status error";
  }
}

example.addEventListener("change", () => { input.value = examples[example.value]; render(); });
mode.addEventListener("change", render);
document.querySelector("#render-button").addEventListener("click", render);
document.querySelector("#download-button").addEventListener("click", () => {
  const blob = new Blob([latestSvg], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "ascii-diagram.svg";
  link.click();
  URL.revokeObjectURL(url);
});
input.addEventListener("keydown", event => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") render(); });
input.value = examples.flow;
render();

function semanticChecks(fixture, diagram, classification) {
  const expected = fixture.expect ?? {};
  const labels = diagram.nodes.map(node => node.label);
  const nodeShapes = diagram.nodes.map(node => node.shape);
  const labelById = new Map(diagram.nodes.map(node => [node.id, node.label]));
  const edges = diagram.edges.map(edge => [labelById.get(edge.source), labelById.get(edge.target)]);
  const checks = [];
  if (expected.nodeLabels) checks.push(["节点标签", JSON.stringify(labels) === JSON.stringify(expected.nodeLabels), `${labels.length} nodes`]);
  if (expected.nodeShapes) checks.push(["节点形状", JSON.stringify(nodeShapes) === JSON.stringify(expected.nodeShapes), nodeShapes.join(", ")]);
  if (expected.edges) checks.push(["有向边", JSON.stringify(edges) === JSON.stringify(expected.edges), `${edges.length} edges`]);
  if (expected.tokenKinds) checks.push(["Token 类型", JSON.stringify(parsedTokens(selectedCase.input)) === JSON.stringify(expected.tokenKinds), `${selectedCase.input.length} chars`]);
  if (expected.diagnostics !== undefined) checks.push(["诊断数量", diagram.diagnostics.length === expected.diagnostics, `${diagram.diagnostics.length} diagnostics`]);
  if (expected.classification) checks.push(["Diagram 分类", classification.kind === expected.classification, `${classification.kind} · ${classification.confidence}`]);
  return checks;
}

function parsedTokens(inputText) { return parseAscii(inputText).tokens.map(token => token.kind); }

function showCase(fixture) {
  selectedCase = fixture;
  const parsed = parseAscii(fixture.input);
  const svg = parsed.classification.kind === "diagram" ? renderSvg(parsed.diagram, fixture.options) : "";
  document.querySelector("#case-title").textContent = fixture.name;
  document.querySelector("#case-input").textContent = fixture.input || "(empty input)";
  document.querySelector("#case-preview").innerHTML = svg || `<p class="not-rendered">未渲染：${parsed.classification.reasons.join("；")}</p>`;
  const checks = semanticChecks(fixture, parsed.diagram, parsed.classification);
  const passed = checks.every(([, ok]) => ok);
  const verdict = document.querySelector("#case-verdict");
  verdict.textContent = passed ? "PASS" : "CHECK";
  verdict.className = `verdict ${passed ? "pass" : "fail"}`;
  document.querySelector("#case-assertions").replaceChildren(...checks.map(([name, ok, detail]) => {
    const row = document.createElement("div");
    row.className = `assertion ${ok ? "assertion-pass" : "assertion-fail"}`;
    row.innerHTML = `<span class="assertion-icon">${ok ? "✓" : "!"}</span><span><b>${name}</b><small>${detail}</small></span>`;
    return row;
  }));
  document.querySelectorAll(".case-item").forEach(item => item.classList.toggle("selected", item.dataset.file === fixture.file));
}

async function loadCases() {
  const list = document.querySelector("#case-list");
  try {
    const files = await fetch("../test/cases/index.json").then(response => response.json());
    const fixtures = await Promise.all(files.map(async file => ({ ...await fetch(`../test/cases/${file}`).then(response => response.json()), file })));
    document.querySelector("#case-count").textContent = `(${fixtures.length})`;
    list.replaceChildren(...fixtures.map(fixture => {
      const item = document.createElement("button");
      item.className = "case-item";
      item.dataset.file = fixture.file;
      item.innerHTML = `<strong>${fixture.name}</strong><small>${fixture.file}</small>`;
      item.addEventListener("click", () => showCase(fixture));
      return item;
    }));
    showCase(fixtures[0]);
  } catch (error) {
    list.textContent = "无法加载回归用例，请通过 npm run demo 启动 HTTP 服务。";
  }
}

document.querySelectorAll(".tab").forEach(tab => tab.addEventListener("click", () => {
  document.querySelectorAll(".tab").forEach(item => item.classList.toggle("active", item === tab));
  document.querySelector("#playground-view").classList.toggle("hidden", tab.dataset.view !== "playground");
  document.querySelector("#regression-view").classList.toggle("hidden", tab.dataset.view !== "regression");
}));
document.querySelector("#load-case-button").addEventListener("click", () => {
  if (!selectedCase) return;
  input.value = selectedCase.input;
  example.value = "";
  render();
  document.querySelector('[data-view="playground"]').click();
});
loadCases();
