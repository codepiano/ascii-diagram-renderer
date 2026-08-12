# LLM ASCII Diagram Renderer

一个无框架依赖的 TypeScript 库：把大模型常见的 ASCII 流程图解析为可检查的 `Diagram IR`，再渲染成安全、可缩放的 SVG。

它适合网页、浏览器扩展、Web Worker 和 Node.js。解析核心不依赖 DOM，SVG 输出也与解析逻辑分离，因此可在 IR 之上接入其他布局或渲染器。

## 能做什么

- 保留字符网格中的原始行列坐标，识别文本、盒节点、连线、箭头和交叉点
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

const { diagram, classification, tokens } = parseAscii(input);

console.log(classification);
// { kind: "diagram", confidence: ..., reasons: [...] }
console.log(diagram.nodes, diagram.edges, tokens);

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
| `ascii-diagram-renderer` | `parseAscii`、类型、`renderSvg` 和严格的 `asciiToSvg` |
| `ascii-diagram-renderer/core` | 仅解析能力：`CharacterGrid`、`tokenize`、`recoverTopology`、`classifyDiagram`、`parseAscii` 与类型 |
| `ascii-diagram-renderer/svg` | SVG 渲染能力：`renderSvg`、`renderLayoutedSvg` |

### `parseAscii(input, options?)`

返回 `{ grid, tokens, diagram, classification }`。`options.detection` 可为：

- `"strict"`：保守判断，适合自动渲染（`asciiToSvg` 固定使用该模式）。
- `"lenient"`：宽松判断，适合需要提示用户或人工确认的交互流程。

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

### `renderSvg(diagram, options?)`

渲染选项包括：

| 选项 | 说明 |
| --- | --- |
| `mode` | `"preserve"`（默认，尽量保持 ASCII 排布）或 `"reflow"`（简单重排） |
| `cellWidth` / `cellHeight` | 字符网格的像素尺寸 |
| `padding` | SVG 四周留白 |
| `fontFamily` / `fontSize` | SVG 文本字体设置 |

## 支持范围与约束

该库以“保守识别”为原则：没有明确连线或箭头的相邻文字不应被推断为关系；普通段落、Markdown 列表等也不应自动变成图。复杂图形可以先通过 `parseAscii` 检查 `tokens`、`diagram` 与 `diagnostics`，再决定是否展示或补充适配规则。

回归用例位于 [`test/cases`](./test/cases)，新增案例后运行 `npm test` 即可验证解析与渲染行为。
