# Regression fixtures

每个 `.json` 文件代表一个来自真实模型输出风格或已发现 bug 的最小案例。

可用字段：

- `input`：原始 ASCII 文本
- `options`：Renderer 选项
- `expect.nodeLabels`：节点标签顺序
- `expect.nodeShapes`：节点形状顺序
- `expect.edges`：按标签表示的 `[source, target]`
- `expect.diagnostics`：诊断数量
- `expect.classification`：严格模式分类
- `expect.lenientClassification`：宽松模式分类
- `expect.svg`：SVG 必须包含的稳定片段

每个 fixture 还会自动检查节点 ID 唯一性，以及 edge/group 对节点的引用完整性。新增案例后直接运行 `npm test`，无需修改测试运行器；如果演示页面也需要展示该案例，再将文件名加入 `index.json`。
