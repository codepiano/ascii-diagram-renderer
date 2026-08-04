import type { Diagram, LayoutedDiagram, RenderOptions } from "./types.js";

const esc = (value: string) => value.replace(/[&<>\"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[ch]!));
export function renderSvg(diagram: Diagram, options: RenderOptions = {}): string {
  const cellWidth = options.cellWidth ?? 9, cellHeight = options.cellHeight ?? 28, padding = options.padding ?? 24, fontSize = options.fontSize ?? 16;
  const positions = new Map<string, { x: number; y: number; w: number; h: number }>();
  if (options.mode === "reflow") diagram.nodes.forEach((n, i) => positions.set(n.id, { x: (i % 3) * 190 + padding, y: Math.floor(i / 3) * 100 + padding, w: Math.max(100, n.label.length * 9 + 28), h: 42 }));
  else diagram.nodes.forEach(n => { const b = n.sourceBounds; positions.set(n.id, { x: b.left * cellWidth + padding, y: b.top * cellHeight + padding, w: Math.max((b.right - b.left + 1) * cellWidth, n.label.length * 9 + 20), h: n.shape === "box" ? Math.max(42, (b.bottom - b.top + 1) * cellHeight) : 34 }); });
  if (options.mode !== "reflow") {
    const anchors = new Map<string, { x?: number; y?: number }>();
    for (const edge of diagram.edges) {
      if (edge.sourcePath.length < 2) continue;
      const anchor = edge.sourcePath[Math.floor(edge.sourcePath.length / 2)];
      const value = edge.direction === "left" || edge.direction === "right"
        ? { y: anchor.row * cellHeight + padding + cellHeight / 2 }
        : { x: anchor.col * cellWidth + padding + cellWidth / 2 };
      for (const id of [edge.source, edge.target]) anchors.set(id, { ...anchors.get(id), ...value });
    }
    for (const [id, anchor] of anchors) {
      const position = positions.get(id)!;
      if (anchor.x !== undefined) position.x = anchor.x - position.w / 2;
      if (anchor.y !== undefined) position.y = anchor.y - position.h / 2;
    }
  }
  const maxX = Math.max(...[...positions.values()].map(p => p.x + p.w), 160) + padding, maxY = Math.max(...[...positions.values()].map(p => p.y + p.h), 80) + padding;
  const point = (id: string, side: "start" | "end") => { const p = positions.get(id)!; return { x: p.x + p.w / 2, y: side === "start" ? p.y + p.h : p.y }; };
  const sourcePoint = (e: Diagram["edges"][number], side: "start" | "end") => {
    const fallback = point(e[side === "start" ? "source" : "target"], side);
    if (options.mode === "reflow" || e.sourcePath.length < 2) return fallback;
    const anchor = e.sourcePath[Math.floor(e.sourcePath.length / 2)];
    const x = anchor.col * cellWidth + padding + cellWidth / 2;
    const node = positions.get(e[side === "start" ? "source" : "target"])!;
    return { x, y: side === "start" ? node.y + node.h : node.y };
  };
  const paths = diagram.edges.map(e => {
    const a = sourcePoint(e, "start"), b = sourcePoint(e, "end");
    const middle = (a.y + b.y) / 2;
    const d = e.direction === "left" || e.direction === "right"
      ? `M ${a.x} ${a.y} L ${middle} ${a.y} L ${middle} ${b.y} L ${b.x} ${b.y}`
      : `M ${a.x} ${a.y} L ${a.x} ${middle} L ${b.x} ${middle} L ${b.x} ${b.y}`;
    return `<path class="edge" d="${d}" marker-end="url(#arrow)"/>`;
  }).join("");
  const nodes = diagram.nodes.map(n => { const p = positions.get(n.id)!; const shape = n.shape === "box" ? `<rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" rx="6"/>` : `<rect class="text-node" x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" rx="6"/>`; return `<g class="node" data-node-id="${esc(n.id)}">${shape}<text x="${p.x + p.w / 2}" y="${p.y + p.h / 2}" text-anchor="middle" dominant-baseline="middle">${esc(n.label)}</text></g>`; }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${maxX} ${maxY}" role="img"><defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z"/></marker></defs><style>.edge{fill:none;stroke:#64748b;stroke-width:2}.node rect{fill:#fff;stroke:#334155;stroke-width:2}.node .text-node{fill:#f8fafc}.node text{font:${fontSize}px ${esc(options.fontFamily ?? "system-ui, sans-serif")};fill:#0f172a}</style>${paths}${nodes}</svg>`;
}

export function renderLayoutedSvg(layouted: LayoutedDiagram, options: RenderOptions = {}): string {
  const diagram: Diagram = {
    ...layouted.diagram,
    nodes: layouted.nodes.map(({ layout, ...node }) => ({ ...node, sourceBounds: { top: layout.y, left: layout.x, bottom: layout.y + layout.height, right: layout.x + layout.width } })),
    edges: layouted.edges.map(({ layout, ...edge }) => ({ ...edge, sourcePath: layout.points }))
  };
  return renderSvg(diagram, { ...options, mode: "preserve", cellWidth: 1, cellHeight: 1, padding: options.padding ?? 0 });
}
