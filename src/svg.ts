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
      if (edge.sourceRoute === "branch") {
        const source = edge.sourcePath[0];
        const sourceValue = edge.direction === "left" || edge.direction === "right"
          ? { y: source.row * cellHeight + padding + cellHeight / 2 }
          : { x: source.col * cellWidth + padding + cellWidth / 2 };
        const targetValue = edge.direction === "left" || edge.direction === "right"
          ? { y: anchor.row * cellHeight + padding + cellHeight / 2 }
          : { x: anchor.col * cellWidth + padding + cellWidth / 2 };
        anchors.set(edge.source, { ...anchors.get(edge.source), ...sourceValue });
        anchors.set(edge.target, { ...anchors.get(edge.target), ...targetValue });
        continue;
      }
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
  // Examples are a semantic list, so give consecutive source rows enough room
  // for their node boxes instead of allowing the boxes to overlap.
  for (const group of diagram.groups.filter(group => group.kind === "examples")) {
    const members = group.members.map(id => positions.get(id)).filter(Boolean) as Array<{ x: number; y: number; w: number; h: number }>;
    if (!members.length) continue;
    const parent = group.parent ? positions.get(group.parent) : undefined;
    const centerX = parent ? parent.x + parent.w / 2 : undefined;
    const contentWidth = Math.max(...members.map(position => position.w));
    let y = Math.min(...members.map(position => position.y));
    for (const position of members) {
      if (centerX !== undefined) position.x = centerX - contentWidth / 2;
      position.y = y;
      y += position.h + 10;
    }
  }
  const minX = Math.min(0, ...[...positions.values()].map(p => p.x)) - 14;
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
    const branchPoint = e.sourceRoute === "branch" && options.mode !== "reflow" ? e.sourcePath[1] : undefined;
    const branchY = branchPoint ? branchPoint.row * cellHeight + padding + cellHeight / 2 : middle;
    const branchSourceX = branchPoint ? e.sourcePath[0].col * cellWidth + padding + cellWidth / 2 : a.x;
    const branchTargetX = branchPoint ? branchPoint.col * cellWidth + padding + cellWidth / 2 : b.x;
    const d = branchPoint
      ? `M ${branchSourceX} ${a.y} L ${branchSourceX} ${branchY} L ${branchTargetX} ${branchY} L ${branchTargetX} ${b.y}`
      : e.direction === "left" || e.direction === "right"
        ? `M ${a.x} ${a.y} L ${middle} ${a.y} L ${middle} ${b.y} L ${b.x} ${b.y}`
        : `M ${a.x} ${a.y} L ${a.x} ${middle} L ${b.x} ${middle} L ${b.x} ${b.y}`;
    const marker = e.arrow === "normal" ? ` marker-end="url(#arrow)"` : "";
    return `<path class="edge" d="${d}"${marker}/>`;
  }).join("");
  const groups = diagram.groups.map(group => {
    const members = group.members.map(id => positions.get(id)).filter(Boolean) as Array<{ x: number; y: number; w: number; h: number }>;
    if (!members.length) return "";
    const left = Math.min(...members.map(p => p.x)) - 14, top = Math.min(...members.map(p => p.y)) - 14;
    const right = Math.max(...members.map(p => p.x + p.w)) + 14, bottom = Math.max(...members.map(p => p.y + p.h)) + 14;
    return `<g class="group"><rect x="${left}" y="${top}" width="${right - left}" height="${bottom - top}" rx="10"/><text x="${left + 10}" y="${top + 14}">${esc(group.label ?? group.kind)}</text></g>`;
  }).join("");
  const nodes = diagram.nodes.map(n => { const p = positions.get(n.id)!; const shape = n.shape === "box" ? `<rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" rx="6"/>` : `<rect class="text-node" x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" rx="6"/>`; return `<g class="node" data-node-id="${esc(n.id)}">${shape}<text x="${p.x + p.w / 2}" y="${p.y + p.h / 2}" text-anchor="middle" dominant-baseline="middle">${esc(n.label)}</text></g>`; }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} 0 ${maxX - minX} ${maxY}" role="img"><defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z"/></marker></defs><style>.edge{fill:none;stroke:#64748b;stroke-width:2}.group rect{fill:#f8fafc;stroke:#aab4c5;stroke-width:1.5;stroke-dasharray:5 4}.group text{font:11px ${esc(options.fontFamily ?? "system-ui, sans-serif")};fill:#748096}.node rect{fill:#fff;stroke:#334155;stroke-width:2}.node .text-node{fill:#f8fafc}.node text{font:${fontSize}px ${esc(options.fontFamily ?? "system-ui, sans-serif")};fill:#0f172a}</style>${groups}${paths}${nodes}</svg>`;
}

export function renderLayoutedSvg(layouted: LayoutedDiagram, options: RenderOptions = {}): string {
  const diagram: Diagram = {
    ...layouted.diagram,
    nodes: layouted.nodes.map(({ layout, ...node }) => ({ ...node, sourceBounds: { top: layout.y, left: layout.x, bottom: layout.y + layout.height, right: layout.x + layout.width } })),
    edges: layouted.edges.map(({ layout, ...edge }) => ({ ...edge, sourcePath: layout.points }))
  };
  return renderSvg(diagram, { ...options, mode: "preserve", cellWidth: 1, cellHeight: 1, padding: options.padding ?? 0 });
}
