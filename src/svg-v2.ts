import { SourceDocument, displayWidth } from "./source.js";
import type { DiagramV2, DiagramV2Edge, EdgePort, RenderOptions } from "./types.js";

type Position = { x: number; y: number; w: number; h: number };
type PixelPoint = { x: number; y: number };
const esc = (value: string) => value.replace(/[&<>\"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[character]!));
const center = (position: Position): PixelPoint => ({ x: position.x + position.w / 2, y: position.y + position.h / 2 });
const portPoint = (position: Position, port: EdgePort): PixelPoint => {
  const midpoint = center(position);
  if (port === "top") return { x: midpoint.x, y: position.y };
  if (port === "bottom") return { x: midpoint.x, y: position.y + position.h };
  if (port === "left") return { x: position.x, y: midpoint.y };
  return { x: position.x + position.w, y: midpoint.y };
};

export function renderSvgV2(diagram: DiagramV2, options: RenderOptions = {}): string {
  const cellWidth = options.cellWidth ?? 9, cellHeight = options.cellHeight ?? 28, padding = options.padding ?? 24, fontSize = options.fontSize ?? 16;
  const source = new SourceDocument(diagram.source.lines.join("\n"));
  const positions = new Map<string, Position>();
  if (options.mode === "reflow") diagram.nodes.forEach((node, index) => positions.set(node.id, {
    x: (index % 3) * 190 + padding, y: Math.floor(index / 3) * 100 + padding,
    w: Math.max(100, displayWidth(node.label) * cellWidth + 28), h: 42
  }));
  else diagram.nodes.forEach(node => {
    const bounds = node.sourceBounds;
    const labelLines = node.label.split("\n");
    const rows = [...Array(bounds.bottom - bounds.top + 1)].map((_, index) => bounds.top + index);
    const left = Math.min(...rows.map(row => source.displayColumn(row, bounds.left)));
    const right = Math.max(...rows.map(row => source.displayColumn(row, bounds.right + 1)));
    positions.set(node.id, {
      x: left * cellWidth + padding,
      y: bounds.top * cellHeight + padding,
      w: Math.max((right - left) * cellWidth, ...labelLines.map(line => displayWidth(line) * cellWidth + 20)),
      h: node.shape === "box" ? Math.max(42, (bounds.bottom - bounds.top + 1) * cellHeight) : labelLines.length === 1 ? 34 : labelLines.length * 20 + 18
    });
  });
  const pixel = (point: { row: number; col: number }): PixelPoint => ({
    x: source.displayColumn(point.row, point.col) * cellWidth + padding + cellWidth / 2,
    y: point.row * cellHeight + padding + cellHeight / 2
  });
  if (options.mode !== "reflow") {
    const anchors = new Map<string, { x?: number; y?: number }>();
    const applyAnchor = (id: string, port: EdgePort, adjacent: { row: number; col: number }) => {
      const value = port === "top" || port === "bottom" ? { x: pixel(adjacent).x } : { y: pixel(adjacent).y };
      anchors.set(id, { ...value, ...anchors.get(id) });
    };
    for (const edge of diagram.edges) {
      if (edge.geometry.points.length < 2) continue;
      applyAnchor(edge.source, edge.geometry.sourcePort, edge.geometry.points[1]);
      applyAnchor(edge.target, edge.geometry.targetPort, edge.geometry.points.at(-2)!);
    }
    for (const [id, anchor] of anchors) {
      const position = positions.get(id)!;
      if (anchor.x !== undefined) position.x = anchor.x - position.w / 2;
      if (anchor.y !== undefined) position.y = anchor.y - position.h / 2;
    }
  }
  for (const group of diagram.groups.filter(group => group.kind === "examples")) {
    const members = group.members.map(id => positions.get(id)).filter(Boolean) as Position[];
    if (!members.length) continue;
    const parent = group.parent ? positions.get(group.parent) : undefined;
    const contentWidth = Math.max(...members.map(position => position.w));
    let y = Math.min(...members.map(position => position.y));
    for (const position of members) {
      if (parent) position.x = parent.x + parent.w / 2 - contentWidth / 2;
      position.y = y;
      y += position.h + 10;
    }
  }
  const edgePoints = (edge: DiagramV2Edge): PixelPoint[] => {
    const sourcePosition = positions.get(edge.source)!, targetPosition = positions.get(edge.target)!;
    if (options.mode === "reflow") {
      const start = portPoint(sourcePosition, edge.geometry.sourcePort), end = portPoint(targetPosition, edge.geometry.targetPort);
      const vertical = edge.geometry.sourcePort === "top" || edge.geometry.sourcePort === "bottom";
      return vertical
        ? [start, { x: start.x, y: (start.y + end.y) / 2 }, { x: end.x, y: (start.y + end.y) / 2 }, end]
        : [start, { x: (start.x + end.x) / 2, y: start.y }, { x: (start.x + end.x) / 2, y: end.y }, end];
    }
    return [
      portPoint(sourcePosition, edge.geometry.sourcePort),
      ...edge.geometry.points.slice(1, -1).map(pixel),
      portPoint(targetPosition, edge.geometry.targetPort)
    ].filter((point, index, points) => index === 0 || point.x !== points[index - 1].x || point.y !== points[index - 1].y);
  };
  const routedPoints = diagram.edges.flatMap(edgePoints);
  const labelPoints = diagram.edges.filter(edge => edge.label).map(edge => pixel(edge.label!.point));
  const allPoints = [...[...positions.values()].flatMap(position => [{ x: position.x, y: position.y }, { x: position.x + position.w, y: position.y + position.h }]), ...routedPoints, ...labelPoints];
  const minX = Math.min(0, ...allPoints.map(point => point.x)) - 14;
  const maxX = Math.max(...allPoints.map(point => point.x), 160) + padding;
  const maxY = Math.max(...allPoints.map(point => point.y), 80) + padding;
  const paths = diagram.edges.map(edge => {
    const points = edgePoints(edge);
    const marker = edge.markerEnd === "arrow" ? ` marker-end="url(#arrow)"` : "";
    return `<path class="edge" d="M ${points.map(point => `${point.x} ${point.y}`).join(" L ")}"${marker}/>`;
  }).join("");
  const edgeLabels = diagram.edges.filter(edge => edge.label).map(edge => {
    const point = pixel(edge.label!.point);
    return `<text class="edge-label" x="${point.x}" y="${point.y}" text-anchor="middle" dominant-baseline="middle">${esc(edge.label!.text)}</text>`;
  }).join("");
  const groups = diagram.groups.map(group => {
    const members = group.members.map(id => positions.get(id)).filter(Boolean) as Position[];
    if (!members.length) return "";
    const left = Math.min(...members.map(position => position.x)) - 14, top = Math.min(...members.map(position => position.y)) - 14;
    const right = Math.max(...members.map(position => position.x + position.w)) + 14, bottom = Math.max(...members.map(position => position.y + position.h)) + 14;
    return `<g class="group"><rect x="${left}" y="${top}" width="${right - left}" height="${bottom - top}" rx="10"/><text x="${left + 10}" y="${top + 14}">${esc(group.label ?? group.kind)}</text></g>`;
  }).join("");
  const nodes = diagram.nodes.map(node => {
    const position = positions.get(node.id)!;
    const shape = node.shape === "box" ? `<rect x="${position.x}" y="${position.y}" width="${position.w}" height="${position.h}" rx="6"/>` : `<rect class="text-node" x="${position.x}" y="${position.y}" width="${position.w}" height="${position.h}" rx="6"/>`;
    const lines = node.label.split("\n"), x = position.x + position.w / 2;
    const text = lines.length === 1
      ? `<text x="${x}" y="${position.y + position.h / 2}" text-anchor="middle" dominant-baseline="middle">${esc(lines[0])}</text>`
      : `<text x="${x}" y="${position.y + position.h / 2 - (lines.length - 1) * 10}" text-anchor="middle" dominant-baseline="middle">${lines.map((line, index) => `<tspan x="${x}"${index ? ` dy="20"` : ""}>${esc(line)}</tspan>`).join("")}</text>`;
    return `<g class="node" data-node-id="${esc(node.id)}">${shape}${text}</g>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} 0 ${maxX - minX} ${maxY}" role="img"><defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z"/></marker></defs><style>.edge{fill:none;stroke:#64748b;stroke-width:2}.edge-label{font:${fontSize}px ${esc(options.fontFamily ?? "system-ui, sans-serif")};fill:#0f172a;paint-order:stroke;stroke:#f8fafc;stroke-width:8px;stroke-linejoin:round}.group rect{fill:#f8fafc;stroke:#aab4c5;stroke-width:1.5;stroke-dasharray:5 4}.group text{font:11px ${esc(options.fontFamily ?? "system-ui, sans-serif")};fill:#748096}.node rect{fill:#fff;stroke:#334155;stroke-width:2}.node .text-node{fill:#f8fafc}.node text{font:${fontSize}px ${esc(options.fontFamily ?? "system-ui, sans-serif")};fill:#0f172a}</style>${groups}${paths}${edgeLabels}${nodes}</svg>`;
}
