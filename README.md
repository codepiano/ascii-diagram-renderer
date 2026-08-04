# LLM ASCII Diagram Renderer

将常见的大模型 ASCII 流程图解析为 Diagram IR，并输出安全、可缩放的 SVG。

## 当前能力

- Character Grid：保留原始行列坐标
- Visual Tokenizer：文本节点、盒节点、横线、竖线、箭头
- Topology Recovery：从显式箭头恢复节点与有向边
- SVG Renderer：`preserve` 与简单 `reflow` 两种模式
- SVG 文本使用实体转义，不把模型输出插入 `innerHTML`

核心解析器与渲染器分离：`./core` 不依赖 DOM，适合浏览器、浏览器插件、Web Worker 和 Node.js；`./svg` 只负责输出 SVG。ELK/Graphviz/Mermaid 适配器可以在 Diagram IR 之上独立增加。

## 使用

```ts
import { parseAscii } from "ascii-diagram-renderer/core";
import { renderSvg } from "ascii-diagram-renderer/svg";

const ascii = `World State
    |
    v
Observation`;

const { diagram, tokens, classification } = parseAscii(ascii);
const svg = renderSvg(diagram, { mode: "preserve" });
```

`classification` 会先判断输入是否像 Diagram：`diagram`、`maybe` 或 `text`。根入口的 `asciiToSvg` 在严格模式下只渲染 `diagram`，对 `maybe` 和 `text` 返回空字符串，避免把不确定内容强行渲染；如果业务已经明确拿到合法 IR，可以直接调用底层 `renderSvg`。

如果希望使用便捷 API，也可以直接从根入口导入：

```ts
import { asciiToSvg } from "ascii-diagram-renderer";
```

`diagram` 的结构是：

```ts
{
  nodes: [{ id, label, shape, sourceBounds }],
  edges: [{ id, source, target, direction, sourcePath }],
  version: "1",
  groups: [],
  diagnostics: []
}
```

## 开发

```bash
npm install
npm test
```
