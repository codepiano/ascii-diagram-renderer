# LLM ASCII Diagram Renderer

一个无框架依赖的 TypeScript 库：把大模型常见的 ASCII 流程图解析为可检查的 `Diagram IR`，再渲染成安全、可缩放的 SVG。

它适合网页、浏览器扩展、Web Worker 和 Node.js。解析核心不依赖 DOM，SVG 输出也与解析逻辑分离，因此可在 IR 之上接入其他布局或渲染器。

## 能做什么

- 使用统一 Unicode 坐标保留原始行列位置，识别文本、盒节点、连线、箭头和交叉点
- 从显式连接符恢复节点、边、方向和分支关系
- 将结果输出为结构化的 `Diagram IR`，便于调试、存储或二次处理
- 提供保留原始位置的 `preserve` 布局，以及简单重排的 `reflow` 布局
- 先对输入分类为 `diagram`、`maybe` 或 `text`；严格便捷 API 不会把普通说明文字强行渲染成图
- 对 SVG 文本做实体转义，不直接把原始 ASCII 输入拼进 `innerHTML`

## 安装与本地运行

发布到 npm 后，可作为依赖安装并使用包名导入：

```bash
npm install ascii-diagram-renderer
```

克隆本仓库进行开发时：

```bash
npm install
npm test
npm run demo
```

`npm run demo` 会先编译 TypeScript，再在 `http://localhost:4173` 启动演示页面。若你要在其他项目中通过本地路径引用本仓库，先执行 `npm run build`。

## 快速开始

最简单的方式是使用根入口的 `asciiToSvg`。它采用严格检测：仅当输入被判断为 `diagram` 时返回 SVG；普通文本或不确定输入会返回空字符串。

```ts
import { asciiToSvg } from "ascii-diagram-renderer";

const ascii = `World State
    |
    v
Observation
    |
    v
Decision`;

const svg = asciiToSvg(ascii, { mode: "preserve" });

if (svg) {
  document.querySelector("#diagram")!.innerHTML = svg;
}
```

## 示例：检查 IR 后再渲染

当你需要展示解析原因、记录诊断信息，或希望自己决定是否渲染时，分别从 `core` 和 `svg` 导入：

```ts
import { parseAscii } from "ascii-diagram-renderer/core";
import { renderSvg } from "ascii-diagram-renderer/svg";

const input = `+-----------+
| User input|
+-----------+
      |
      v
+-----------+
| Validate  |
+-----------+`;

const { diagram, classification, analysis, tokens } = parseAscii(input);

console.log(classification);
// { kind: "diagram", confidence: ..., reasons: [...] }
console.log(diagram.nodes, diagram.edges, tokens);
console.log(analysis.accepted, analysis.rejected);

if (classification.kind === "diagram") {
  const svg = renderSvg(diagram, { mode: "reflow", padding: 24 });
  document.querySelector("#diagram")!.innerHTML = svg;
}
```

`parseAscii` 始终会返回解析结果，即使输入不是图；调用方可以根据 `classification`、`diagnostics` 或自己的业务规则决定是否展示。已经确认 IR 合法的场景，也可以直接调用 `renderSvg(diagram)`，无需再次分类。

## 示例：横向箭头与分支

箭头可以使用 ASCII 箭头或 Unicode 箭头；显式连接符是恢复拓扑关系的依据。

```ts
import { asciiToSvg } from "ascii-diagram-renderer";

const flow = `Request → Authenticate → Service
                         |
                         v
                       Audit log`;

const svg = asciiToSvg(flow, {
  mode: "preserve",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontSize: 14,
  cellWidth: 9,
  cellHeight: 20,
});
```

## API

| 导入 | 用途 |
| --- | --- |
| `ascii-diagram-renderer` | v1/v2 解析、类型、SVG 渲染和严格便捷 API |
| `ascii-diagram-renderer/core` | 无 DOM 的 `parseAscii` / `parseAsciiV2`，以及为兼容保留的低层 API |
| `ascii-diagram-renderer/svg` | `renderSvg`、`renderSvgV2`、`renderLayoutedSvg` |

### `parseAscii(input, options?)`

返回 `{ grid, tokens, diagram, classification, analysis }`。`options.detection` 可为：

- `"strict"`：要求恢复出节点关系或发现强结构证据，适合自动渲染（`asciiToSvg` 固定使用该模式）。
- `"lenient"`：未恢复出关系但存在多个节点和图形符号时返回 `maybe`，适合人工确认流程。

`diagram` 的主要结构为：

```ts
{
  version: "1",
  nodes: [{ id, label, shape, sourceBounds }],
  edges: [{ id, source, target, direction, sourcePath }],
  groups: [{ id, kind, members }],
  diagnostics: [],
  source: { lines, width, height },
}
```

`Diagram v1` 是稳定兼容边界。内部解析器先生成带通用折线 geometry 和识别证据的 canonical IR，再通过适配器生成上述结构；因此新增识别规则不需要把规则名称扩散到公共 IR。

`analysis` 用来解释解析过程，而不改变 Diagram v1：

```ts
{
  accepted: [{ phase, recognizer, confidence, evidence, consumes }],
  rejected: [{ phase, recognizer, confidence, reason, conflictsWith }],
  unconsumedEvidence: [],
  metrics: { nodeCount, edgeCount, connectorComponentCount, ... },
  diagnostics: [],
}
```

例如，一个普通说明段落可能产生低置信度的 `examples` 候选。该候选不会写入 `diagram.groups`，但会以 `reason: "low-confidence"` 保留在 `analysis.rejected`，调用方可以解释为什么没有采用它。

### `parseAsciiV2(input, options?)`

当调用方需要长期引用节点、检查识别证据或直接消费通用路由时，可以显式选择 Diagram v2：

```ts
import { parseAsciiV2 } from "ascii-diagram-renderer/core";
import { renderSvg } from "ascii-diagram-renderer/svg";

const parsed = parseAsciiV2("输入 → 处理 → 输出");

console.log(parsed.diagram.version); // "2"
console.log(parsed.diagram.nodes[0].id); // 稳定的内容身份 ID
console.log(parsed.diagram.edges[0].geometry);

const svg = renderSvg(parsed.diagram);
```

Diagram v2 与 v1 的主要区别：

- 节点、边和分组使用稳定内容 ID；在前面插入无关节点不会导致已有 ID 整体重编号。
- edge 使用 `{ kind: "polyline", points, sourcePort, targetPort }`，不包含 `sourceRoute: "branch" | "cycle"` 等 renderer 特例。
- edge/group 保留 `recognizer`、`confidence` 和 `evidence` provenance。
- preserve SVG 使用 Unicode 显示列计算 CJK、全角字符和 emoji 的位置与宽度。

`renderSvg` 会根据 `version` 自动接受 Diagram v1 或 v2；也可以用 `renderSvgV2` 明确限制输入。严格便捷入口 `asciiToSvgV2(input, options?)` 与 `asciiToSvg` 行为相同，只在分类为 `diagram` 时返回 SVG。

稳定 ID 基于语义内容和同内容出现次数，而不是数组位置。若同名同形节点自身被重新排序，其 occurrence 后缀可能变化；需要跨任意语义编辑保持身份时，调用方仍应维护自己的持久映射。

### 解析架构

解析核心按不同抽象层组织：

1. `SourceDocument` 统一换行、Unicode 字符坐标和文本切片。
2. `GlyphGraph` 将 `│`、`─`、`┼` 等字符表示为带 north/east/south/west 端口的二维连接图，并生成 connector components、端点、junction 和可追踪路径。
3. tokenizer 提取文本、盒子、线和箭头等源事实。
4. cycle、branch、arrow、line、group recognizer 分别提交带置信度、证据和资源占用的候选解释。
5. resolver 按明确优先级和证据冲突选择解释；recognizer 的注册顺序不决定结果。
6. canonical IR 原生形成 Diagram v2；Diagram v1 由兼容 adapter 生成，分类器只读取同一次裁决产生的 `ParseAnalysis`。

新增内置语法时，应优先增加独立 recognizer 和 fixture，而不是在 `recoverTopology` 中加入依赖执行顺序的条件。source、glyph、candidate 和 canonical 构建过程保持为包内实现细节；`CharacterGrid`、`tokenize`、`recoverTopology` 和 token 形式的 `classifyDiagram` 仅为既有兼容与诊断用途继续导出。现有集成继续使用 `parseAscii`，需要稳定身份和通用 geometry 的新集成使用 `parseAsciiV2`。

### `renderSvg(diagram, options?)`

渲染选项包括：

| 选项 | 说明 |
| --- | --- |
| `mode` | `"preserve"`（默认，尽量保持 ASCII 排布）或 `"reflow"`（简单重排） |
| `cellWidth` / `cellHeight` | 字符网格的像素尺寸 |
| `padding` | SVG 四周留白 |
| `fontFamily` / `fontSize` | SVG 文本字体设置 |

## 支持范围与约束

该库以“保守识别”为原则：没有明确连线或箭头的相邻文字不应被推断为关系；普通段落、Markdown 列表等也不应自动变成图。复杂图形可以先通过 `parseAscii` 检查 `analysis`、`diagram` 与 `diagnostics`，再决定是否展示或补充适配规则。

回归用例位于 [`test/cases`](./test/cases)，新增案例后运行 `npm test` 即可验证解析与渲染行为。
