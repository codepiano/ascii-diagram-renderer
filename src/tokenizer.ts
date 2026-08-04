import { CharacterGrid } from "./grid.js";
import type { Bounds, Point, Token } from "./types.js";

const vertical = new Set(["|", "│", "║", "┃"]);
const horizontal = new Set(["-", "─", "═", "━"]);
const arrows: Record<string, "up" | "down" | "left" | "right"> = {
  "^": "up", "↑": "up", "v": "down", "▼": "down", "↓": "down",
  "←": "left", "→": "right", "▶": "right"
};
const boxChars = new Set(["+", "┌", "┐", "└", "┘", "╭", "╮", "╰", "╯"]);
const connectors = new Set([...vertical, ...horizontal, ...boxChars, ...Object.keys(arrows)]);

export function tokenize(grid: CharacterGrid): Token[] {
  const tokens: Token[] = [];
  const used = new Set<string>();
  const at = (row: number, col: number) => grid.char({ row, col });
  const key = (p: Point) => `${p.row}:${p.col}`;
  const isArrowAt = (row: number, col: number) => {
    const ch = at(row, col);
    if (ch !== "v" && ch !== "^") return Boolean(arrows[ch]);
    return grid.isBlank({ row, col: col - 1 }) && grid.isBlank({ row, col: col + 1 });
  };
  const isConnectorAt = (row: number, col: number) => connectors.has(at(row, col)) && (vertical.has(at(row, col)) || horizontal.has(at(row, col)) || boxChars.has(at(row, col)) || isArrowAt(row, col));

  // Box detection comes first so its borders are not mistaken for free edges.
  for (let r = 0; r < grid.height; r++) for (let c = 0; c < grid.width; c++) {
    if (!boxChars.has(at(r, c)) || used.has(key({ row: r, col: c }))) continue;
    const right = [...Array(grid.width - c - 1)].map((_, i) => at(r, c + i + 1));
    const end = right.findIndex(ch => boxChars.has(ch) && at(r, c + right.findIndex(x => boxChars.has(x)) + 1) === ch);
    const closeCol = right.findIndex(ch => ["+", "┐", "╮"].includes(ch));
    if (closeCol < 1 || !right.slice(0, closeCol).every(ch => horizontal.has(ch))) continue;
    const bottom = [...Array(grid.height - r - 1)].map((_, i) => at(r + i + 1, c));
    const closeRow = bottom.findIndex(ch => ["+", "┘", "╯"].includes(ch));
    if (closeRow < 1 || !bottom.slice(0, closeRow).every(ch => vertical.has(ch))) continue;
    const br = { row: r + closeRow + 1, col: c + closeCol + 1 };
    if (!["+", "┘", "╯"].includes(at(br.row, br.col))) continue;
    const label = grid.lines.slice(r + 1, br.row).map(line => line.slice(c + 1, br.col).trim()).filter(Boolean).join(" ");
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
      if (vertical.has(ch) || horizontal.has(ch)) {
        const orientation = vertical.has(ch) ? "vertical" : "horizontal";
        const points: Point[] = [];
        while (c < grid.width && (orientation === "vertical" ? vertical.has(at(r, c)) : horizontal.has(at(r, c)))) { points.push({ row: r, col: c++ }); }
        tokens.push({ kind: "line", orientation, points }); continue;
      }
      if (!isConnectorAt(r, c) && !grid.isBlank({ row: r, col: c })) {
        const start = c;
        while (c < grid.width && !isConnectorAt(r, c)) c++;
        const text = grid.lines[r].slice(start, c).trim();
        if (text) tokens.push({ kind: "text", text, bounds: { top: r, left: start, bottom: r, right: c - 1 } });
        continue;
      }
      c++;
    }
  }
  return tokens;
}
