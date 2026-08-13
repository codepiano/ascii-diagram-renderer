import { CharacterGrid } from "./grid.js";
import { GlyphGraph } from "./glyph-graph.js";
import type { Bounds, Point } from "./types.js";

export type Token =
  | { kind: "text"; text: string; bounds: Bounds }
  | { kind: "line"; orientation: "horizontal" | "vertical"; points: Point[] }
  | { kind: "junction"; point: Point }
  | { kind: "arrow"; direction: "up" | "down" | "left" | "right"; point: Point }
  | { kind: "box"; bounds: Bounds; label: string };

const vertical = new Set(["|", "│", "║", "┃"]);
const horizontal = new Set(["-", "─", "═", "━"]);
const arrows: Record<string, "up" | "down" | "left" | "right"> = {
  "^": "up", "↑": "up", "v": "down", "▼": "down", "↓": "down",
  "←": "left", "→": "right", "▶": "right"
};
const boxChars = new Set(["+", "┌", "┐", "└", "┘", "╭", "╮", "╰", "╯"]);
const horizontalJunctions = new Set(["┌", "┐", "└", "┘", "├", "┤", "┬", "┴", "┼"]);
const verticalJunctions = new Set(["┌", "┐", "└", "┘", "├", "┤", "┬", "┴", "┼"]);
const connectors = new Set([...vertical, ...horizontal, ...boxChars, ...Object.keys(arrows)]);

export function tokenize(grid: CharacterGrid, glyphs = new GlyphGraph(grid)): Token[] {
  const tokens: Token[] = [];
  const used = new Set<string>();
  const at = (row: number, col: number) => grid.char({ row, col });
  const key = (p: Point) => `${p.row}:${p.col}`;
  const verticalColumnsAt = (row: number) => [...Array(grid.width)].map((_, col) => col).filter(col => vertical.has(at(row, col)));
  const nearbyColumnAnchors = (row: number, left: number, right: number) => {
    const candidates: Array<{ distance: number; columns: number[] }> = [];
    for (let distance = 1; distance <= 3; distance++) {
      for (const candidateRow of [row - distance, row + distance]) {
        const columns = verticalColumnsAt(candidateRow).filter(col => col >= left && col < right);
        if (columns.length >= 2) candidates.push({ distance, columns });
      }
    }
    candidates.sort((a, b) => b.columns.length - a.columns.length || a.distance - b.distance);
    return candidates[0]?.columns ?? [];
  };
  const isArrowAt = (row: number, col: number) => {
    const ch = at(row, col);
    if (ch !== "v" && ch !== "^") return Boolean(arrows[ch]);
    return grid.isBlank({ row, col: col - 1 }) && grid.isBlank({ row, col: col + 1 });
  };
  const isConnectorAt = (row: number, col: number) => glyphs.isConnector({ row, col }) || (connectors.has(at(row, col)) && isArrowAt(row, col));

  // Box detection comes first so its borders are not mistaken for free edges.
  for (let r = 0; r < grid.height; r++) for (let c = 0; c < grid.width; c++) {
    if (!boxChars.has(at(r, c)) || used.has(key({ row: r, col: c }))) continue;
    const right = [...Array(grid.width - c - 1)].map((_, i) => at(r, c + i + 1));
    const closeCol = right.findIndex(ch => ["+", "┐", "╮"].includes(ch));
    if (closeCol < 1 || !right.slice(0, closeCol).every(ch => horizontal.has(ch))) continue;
    const bottom = [...Array(grid.height - r - 1)].map((_, i) => at(r + i + 1, c));
    const closeRow = bottom.findIndex(ch => ["+", "┘", "╯"].includes(ch));
    if (closeRow < 1 || !bottom.slice(0, closeRow).every(ch => vertical.has(ch))) continue;
    const br = { row: r + closeRow + 1, col: c + closeCol + 1 };
    if (!["+", "┘", "╯"].includes(at(br.row, br.col))) continue;
    const label = [...Array(br.row - r - 1)].map((_, index) => grid.slice(r + index + 1, c + 1, br.col).trim()).filter(Boolean).join(" ");
    const bounds = { top: r, left: c, bottom: br.row, right: br.col };
    tokens.push({ kind: "box", bounds, label });
    for (let rr = r; rr <= br.row; rr++) for (let cc = c; cc <= br.col; cc++) used.add(`${rr}:${cc}`);
  }

  for (let r = 0; r < grid.height; r++) {
    let c = 0;
    while (c < grid.width) {
      const ch = at(r, c);
      if (used.has(`${r}:${c}`)) { c++; continue; }
      if (isArrowAt(r, c)) { tokens.push({ kind: "arrow", direction: arrows[ch], point: { row: r, col: c } }); c++; continue; }
      if (vertical.has(ch) || horizontal.has(ch) || horizontalJunctions.has(ch) || verticalJunctions.has(ch)) {
        const orientation = vertical.has(ch) ? "vertical" : "horizontal";
        const points: Point[] = [];
        const continues = (value: string) => orientation === "vertical" ? vertical.has(value) || verticalJunctions.has(value) : horizontal.has(value) || horizontalJunctions.has(value);
        while (c < grid.width && continues(at(r, c))) { points.push({ row: r, col: c++ }); }
        tokens.push({ kind: "line", orientation, points }); continue;
      }
      if (!isConnectorAt(r, c) && !grid.isBlank({ row: r, col: c })) {
        const start = c;
        while (c < grid.width && !isConnectorAt(r, c)) c++;
        const raw = grid.slice(r, start, c).replace(/\s+$/, "");
        const anchors = nearbyColumnAnchors(r, start, c);
        const splitAtGap = (midpoint: number) => {
          const line = grid.rows[r].join("");
          const gaps = [...line.matchAll(/ {2,}/g)].map(match => ({ start: match.index!, end: match.index! + match[0].length }));
          const nearest = gaps.filter(gap => gap.start > start && gap.end < c).sort((a, b) => Math.abs((a.start + a.end) / 2 - midpoint) - Math.abs((b.start + b.end) / 2 - midpoint))[0];
          return nearest ? Math.round((nearest.start + nearest.end) / 2) : Math.floor(midpoint);
        };
        const segments = anchors.length >= 2
          ? [start, ...anchors.slice(1).map((anchor, index) => splitAtGap((anchors[index] + anchor) / 2)), c]
          : null;
        if (segments) {
          for (let index = 0; index < segments.length - 1; index++) {
            const segmentStart = segments[index], segmentEnd = segments[index + 1];
            const segment = grid.slice(r, segmentStart, segmentEnd);
            const text = segment.trim();
            const first = segment.search(/\S/);
            if (text && first >= 0) tokens.push({ kind: "text", text, bounds: { top: r, left: segmentStart + first, bottom: r, right: segmentStart + first + [...text].length - 1 } });
          }
        } else {
          const columnSpans = /\S(?:.*?\S)?(?=\s{2,}|$)/g;
          for (const match of raw.matchAll(columnSpans)) {
            const text = match[0].trim();
            const left = start + match.index! + match[0].search(/\S/);
            if (text) tokens.push({ kind: "text", text, bounds: { top: r, left, bottom: r, right: left + [...text].length - 1 } });
          }
        }
        continue;
      }
      c++;
    }
  }
  return tokens;
}
