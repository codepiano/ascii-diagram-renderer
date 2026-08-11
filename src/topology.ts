import type { Bounds, Diagram, DiagramEdge, DiagramNode, Point, Token } from "./types.js";

const center = (b: Bounds): Point => ({ row: Math.round((b.top + b.bottom) / 2), col: Math.round((b.left + b.right) / 2) });
const distance = (a: Point, b: Point) => Math.abs(a.row - b.row) + Math.abs(a.col - b.col);
const nodeTokens = (tokens: Token[]) => tokens.filter((t): t is Extract<Token, { kind: "text" | "box" }> => t.kind === "text" || t.kind === "box");

function mergeMultilineTextNodes(nodes: DiagramNode[], lines: Token[]): DiagramNode[] {
  const verticals = lines.filter((token): token is Extract<Token, { kind: "line" }> => token.kind === "line" && token.orientation === "vertical");
  const consumed = new Set<string>();
  const replacements = new Map<string, DiagramNode>();
  for (const parent of nodes) {
    if (parent.shape !== "text") continue;
    const parentCenter = center(parent.sourceBounds);
    const outgoing = verticals.filter(line => line.points.some(point => point.row === parent.sourceBounds.bottom + 1)).sort((a, b) => Math.abs(a.points[0].col - parentCenter.col) - Math.abs(b.points[0].col - parentCenter.col))[0];
    if (!outgoing) continue;
    const axis = outgoing.points[0].col;
    const startRow = parent.sourceBounds.bottom + 2;
    const closing = verticals.filter(line => line.points.some(point => point.col === axis && point.row >= startRow)).flatMap(line => line.points.filter(point => point.col === axis && point.row >= startRow)).sort((a, b) => a.row - b.row)[0];
    if (!closing || closing.row === startRow) continue;
    const descriptions = nodes.filter(candidate => candidate.id !== parent.id && !consumed.has(candidate.id) && candidate.shape === "text" && candidate.sourceBounds.top >= startRow && candidate.sourceBounds.bottom < closing.row).filter(candidate => {
      const candidateCenter = center(candidate.sourceBounds);
      const nearerParent = nodes.filter(other => other.id !== parent.id && other.sourceBounds.top === parent.sourceBounds.top).every(other => Math.abs(candidateCenter.col - axis) <= Math.abs(candidateCenter.col - center(other.sourceBounds).col));
      return nearerParent;
    }).sort((a, b) => a.sourceBounds.top - b.sourceBounds.top || a.sourceBounds.left - b.sourceBounds.left);
    // A single following row is normally the next node in a vertical flow.
    // Treat it as a text domain only when the author supplied a real block.
    if (descriptions.length < 2) continue;
    const [body, ...continuations] = descriptions;
    continuations.forEach(description => consumed.add(description.id));
    replacements.set(body.id, {
      ...body,
      label: descriptions.map(description => description.label).join("\n"),
      sourceBounds: {
        top: body.sourceBounds.top,
        left: Math.min(...descriptions.map(description => description.sourceBounds.left)),
        bottom: Math.max(...descriptions.map(description => description.sourceBounds.bottom)),
        right: Math.max(...descriptions.map(description => description.sourceBounds.right))
      }
    });
  }
  return nodes.filter(node => !consumed.has(node.id)).map(node => replacements.get(node.id) ?? node);
}

export function recoverTopology(tokens: Token[], source: { lines: string[]; width: number; height: number }): Diagram {
  let nodes: DiagramNode[] = nodeTokens(tokens).map((token, i) => ({ id: `n${i + 1}`, label: token.kind === "box" ? token.label : token.text, shape: token.kind === "box" ? "box" : "text", sourceBounds: token.bounds }));
  const arrows = tokens.filter((t): t is Extract<Token, { kind: "arrow" }> => t.kind === "arrow");
  const lines = tokens.filter((t): t is Extract<Token, { kind: "line" }> => t.kind === "line");
  nodes = mergeMultilineTextNodes(nodes, tokens);
  const horizontalRows = new Set(lines.filter(line => line.orientation === "horizontal").map(line => line.points[0].row));
  const edges: DiagramEdge[] = [];
  const groups: Diagram["groups"] = [];
  const consumedArrows = new Set<Extract<Token, { kind: "arrow" }>>();

  // Recognize a common ASCII idiom for a two-party commercial/event cycle:
  // labels sit on the top/bottom rails, while arrowheads live on the side rails.
  // The rails are intentionally not emitted as free edges: together they are one
  // directed connection in each direction, and the rail text labels those edges.
  const upArrows = arrows.filter(arrow => arrow.direction === "up");
  const downArrows = arrows.filter(arrow => arrow.direction === "down");
  for (const leftArrow of upArrows) for (const rightArrow of downArrows) {
    if (leftArrow.point.col >= rightArrow.point.col) continue;
    const top = Math.min(leftArrow.point.row, rightArrow.point.row);
    const bottom = Math.max(leftArrow.point.row, rightArrow.point.row);
    const leftNode = nodes.filter(node => center(node.sourceBounds).col <= leftArrow.point.col && center(node.sourceBounds).row >= top && center(node.sourceBounds).row <= bottom).sort((a, b) => distance(center(a.sourceBounds), leftArrow.point) - distance(center(b.sourceBounds), leftArrow.point))[0];
    const rightNode = nodes.filter(node => center(node.sourceBounds).col >= rightArrow.point.col && center(node.sourceBounds).row >= top && center(node.sourceBounds).row <= bottom).sort((a, b) => distance(center(a.sourceBounds), rightArrow.point) - distance(center(b.sourceBounds), rightArrow.point))[0];
    const railLabel = (side: "top" | "bottom") => nodes.filter(node => {
      const nodeCenter = center(node.sourceBounds);
      return nodeCenter.col > leftArrow.point.col && nodeCenter.col < rightArrow.point.col && (side === "top" ? nodeCenter.row < top : nodeCenter.row > bottom);
    }).sort((a, b) => side === "top" ? b.sourceBounds.top - a.sourceBounds.top : a.sourceBounds.top - b.sourceBounds.top)[0];
    const topLabel = railLabel("top");
    const bottomLabel = railLabel("bottom");
    if (!leftNode || !rightNode || !topLabel || !bottomLabel) continue;
    const leftCenter = center(leftNode.sourceBounds), rightCenter = center(rightNode.sourceBounds);
    edges.push(
      { id: `e${edges.length + 1}`, source: leftNode.id, target: rightNode.id, direction: "right", sourcePath: [leftCenter, { row: topLabel.sourceBounds.top, col: leftArrow.point.col }, { row: topLabel.sourceBounds.top, col: rightArrow.point.col }, rightCenter], sourceRoute: "cycle", arrow: "normal", label: topLabel.label, labelPoint: center(topLabel.sourceBounds) },
      { id: `e${edges.length + 2}`, source: rightNode.id, target: leftNode.id, direction: "left", sourcePath: [rightCenter, { row: bottomLabel.sourceBounds.bottom, col: rightArrow.point.col }, { row: bottomLabel.sourceBounds.bottom, col: leftArrow.point.col }, leftCenter], sourceRoute: "cycle", arrow: "normal", label: bottomLabel.label, labelPoint: center(bottomLabel.sourceBounds) }
    );
    nodes = nodes.filter(node => node.id !== topLabel.id && node.id !== bottomLabel.id);
    consumedArrows.add(leftArrow);
    consumedArrows.add(rightArrow);
    break;
  }
  // A horizontal trunk followed by downward arrowheads is a tree fan-out even
  // when its center is a Unicode junction such as ┼ (rather than a plain |).
  // Recover it before individual-arrow recovery so all children share the trunk.
  for (const horizontal of lines.filter(line => line.orientation === "horizontal")) {
    const row = horizontal.points[0].row;
    const left = horizontal.points[0].col;
    const right = horizontal.points.at(-1)!.col;
    const verticalAbove = [...new Set(lines.filter(line => line.orientation === "vertical").flatMap(line => line.points.filter(point => point.row === row - 1).map(point => point.col)))].filter(col => col >= left && col <= right);
    const downArrows = arrows.filter(arrow => arrow.direction === "down" && arrow.point.row === row + 1 && arrow.point.col >= left && arrow.point.col <= right);
    const verticalBelow = [...new Set(lines.filter(line => line.orientation === "vertical").flatMap(line => line.points.filter(point => point.row === row + 1).map(point => point.col)))].filter(col => col >= left && col <= right);
    const above = (col: number) => nodes.filter(node => node.sourceBounds.bottom < row && node.sourceBounds.left <= col && node.sourceBounds.right >= col).sort((a, b) => b.sourceBounds.bottom - a.sourceBounds.bottom)[0];
    const below = (col: number) => nodes.filter(node => node.sourceBounds.top > row && node.sourceBounds.left <= col && node.sourceBounds.right >= col).sort((a, b) => a.sourceBounds.top - b.sourceBounds.top)[0];
    const sourceColumns = verticalAbove;
    const targetColumns = downArrows.length ? downArrows.map(arrow => arrow.point.col) : verticalBelow;
    const parents = sourceColumns.map(above).filter(Boolean) as DiagramNode[];
    const targets = targetColumns.map(below).filter(Boolean) as DiagramNode[];
    if (!parents.length || !targets.length) continue;
    const pairs = parents.length === 1 || targets.length === 1 ? parents.flatMap(parent => targets.map(target => [parent, target] as const)) : parents.map((parent, index) => [parent, targets[index]] as const).filter((pair): pair is readonly [DiagramNode, DiagramNode] => Boolean(pair[1]));
    for (const [parent, target] of pairs) {
      if (edges.some(edge => edge.source === parent.id && edge.target === target.id)) continue;
      const col = targetColumns[targets.indexOf(target)] ?? sourceColumns[parents.indexOf(parent)];
      edges.push({ id: `e${edges.length + 1}`, source: parent.id, target: target.id, direction: "down", sourcePath: [center(parent.sourceBounds), { row, col }, center(target.sourceBounds)], sourceRoute: "branch", arrow: downArrows.length ? "normal" : "none" });
    }
  }
  for (const arrow of arrows) {
    if (consumedArrows.has(arrow)) continue;
    if (edges.some(edge => edge.sourceRoute === "branch" && edge.arrow === "normal" && edge.sourcePath[1]?.row === arrow.point.row - 1 && edge.sourcePath[1]?.col === arrow.point.col)) continue;
    const before = nodes.filter(n => center(n.sourceBounds).row < arrow.point.row || (center(n.sourceBounds).row === arrow.point.row && center(n.sourceBounds).col < arrow.point.col));
    const after = nodes.filter(n => center(n.sourceBounds).row > arrow.point.row || (center(n.sourceBounds).row === arrow.point.row && center(n.sourceBounds).col > arrow.point.col));
    const candidates = arrow.direction === "down" || arrow.direction === "up" ? [before.sort((a,b) => distance(center(b.sourceBounds), arrow.point) - distance(center(a.sourceBounds), arrow.point)).at(-1), after.sort((a,b) => distance(center(a.sourceBounds), arrow.point) - distance(center(b.sourceBounds), arrow.point))[0]] : [before.at(-1), after[0]];
    const sourceNode = arrow.direction === "up" || arrow.direction === "left" ? candidates[1] : candidates[0];
    const targetNode = arrow.direction === "up" || arrow.direction === "left" ? candidates[0] : candidates[1];
    if (sourceNode && targetNode && sourceNode.id !== targetNode.id && !edges.some(e => e.source === sourceNode.id && e.target === targetNode.id)) edges.push({ id: `e${edges.length + 1}`, source: sourceNode.id, target: targetNode.id, direction: arrow.direction, sourcePath: [center(sourceNode.sourceBounds), arrow.point, center(targetNode.sourceBounds)], sourceRoute: "orthogonal", arrow: "normal" });
  }
  // A line between two nodes is a valid connection even when the model omitted an arrowhead.
  for (const line of lines) {
    const lineBounds = { top: line.points[0].row, left: line.points[0].col, bottom: line.points.at(-1)!.row, right: line.points.at(-1)!.col };
    if (line.orientation === "vertical") {
      if (line.points.some(point => horizontalRows.has(point.row - 1) || horizontalRows.has(point.row + 1))) continue;
      if (nodes.some(node => node.sourceBounds.top <= lineBounds.top && node.sourceBounds.bottom >= lineBounds.bottom && node.sourceBounds.left <= lineBounds.left && node.sourceBounds.right >= lineBounds.right)) continue;
      const sourceNode = nodes.filter(node => node.sourceBounds.bottom < lineBounds.top).sort((a, b) => b.sourceBounds.bottom - a.sourceBounds.bottom || Math.abs(center(a.sourceBounds).col - lineBounds.left) - Math.abs(center(b.sourceBounds).col - lineBounds.left))[0];
      const targetNode = nodes.filter(node => node.sourceBounds.top > lineBounds.bottom).sort((a, b) => a.sourceBounds.top - b.sourceBounds.top || Math.abs(center(a.sourceBounds).col - lineBounds.left) - Math.abs(center(b.sourceBounds).col - lineBounds.left))[0];
      if (sourceNode && targetNode && !edges.some(edge => edge.source === sourceNode.id && edge.target === targetNode.id)) edges.push({ id: `e${edges.length + 1}`, source: sourceNode.id, target: targetNode.id, direction: "down", sourcePath: [center(sourceNode.sourceBounds), line.points[Math.floor(line.points.length / 2)], center(targetNode.sourceBounds)], sourceRoute: "vertical", arrow: "none" });
    } else {
      const sourceNode = nodes.filter(node => node.sourceBounds.right < lineBounds.left && node.sourceBounds.top <= lineBounds.top && node.sourceBounds.bottom >= lineBounds.top).sort((a, b) => b.sourceBounds.right - a.sourceBounds.right)[0];
      const targetNode = nodes.filter(node => node.sourceBounds.left > lineBounds.right && node.sourceBounds.top <= lineBounds.top && node.sourceBounds.bottom >= lineBounds.top).sort((a, b) => a.sourceBounds.left - b.sourceBounds.left)[0];
      if (sourceNode && targetNode && !edges.some(edge => edge.source === sourceNode.id && edge.target === targetNode.id)) edges.push({ id: `e${edges.length + 1}`, source: sourceNode.id, target: targetNode.id, direction: "right", sourcePath: [center(sourceNode.sourceBounds), line.points[Math.floor(line.points.length / 2)], center(targetNode.sourceBounds)], sourceRoute: "horizontal", arrow: "none" });
    }
  }
  // A horizontal trunk with vertical stubs represents a fan-out/fan-in.
  for (const horizontal of lines.filter(line => line.orientation === "horizontal")) {
    const row = horizontal.points[0].row;
    if (arrows.some(arrow => arrow.direction === "down" && arrow.point.row === row + 1)) continue;
    const left = horizontal.points[0].col;
    const right = horizontal.points.at(-1)!.col;
    const columns = [...new Set(lines.filter(line => line.orientation === "vertical").flatMap(line => line.points.filter(point => point.row === row - 1 || point.row === row + 1).map(point => point.col)))].filter(col => col >= left && col <= right);
    const above = (col: number) => nodes.filter(node => node.sourceBounds.bottom < row && node.sourceBounds.left <= col && node.sourceBounds.right >= col).sort((a, b) => b.sourceBounds.bottom - a.sourceBounds.bottom)[0];
    const below = (col: number) => nodes.filter(node => node.sourceBounds.top > row && node.sourceBounds.left <= col && node.sourceBounds.right >= col).sort((a, b) => a.sourceBounds.top - b.sourceBounds.top)[0];
    const branchNodes = columns.map(col => ({ col, target: below(col) })).filter(branch => branch.target);
    const parent = columns.map(col => above(col)).find(Boolean);
    if (!parent) continue;
    for (const branch of branchNodes) {
      if (!branch.target || edges.some(edge => edge.source === parent.id && edge.target === branch.target.id)) continue;
      edges.push({ id: `e${edges.length + 1}`, source: parent.id, target: branch.target.id, direction: "down", sourcePath: [center(parent.sourceBounds), { row, col: branch.col }, center(branch.target.sourceBounds)], sourceRoute: "branch", arrow: "none" });
    }
  }
  // A blank line followed by several unconnected text rows commonly means
  // "examples of the preceding node" in LLM-generated diagrams.
  for (let i = 0; i < nodes.length - 2; i++) {
    const parent = nodes[i];
    const first = nodes[i + 1];
    const gap = source.lines.slice(parent.sourceBounds.bottom + 1, first.sourceBounds.top);
    if (gap.length === 0 || !gap.every(line => line.trim() === "")) continue;
    const members = [first];
    for (let j = i + 2; j < nodes.length; j++) {
      const previous = nodes[j - 1];
      const current = nodes[j];
      if (current.sourceBounds.top - previous.sourceBounds.bottom !== 1) break;
      if (tokens.some(token => (token.kind === "line" && token.points.some(point => point.row === current.sourceBounds.top)) || (token.kind === "arrow" && token.point.row === current.sourceBounds.top))) break;
      members.push(current);
    }
    if (members.length < 2) continue;
    const memberIds = new Set(members.map(member => member.id));
    if (groups.some(group => group.members.some(id => memberIds.has(id)))) continue;
    groups.push({ id: `g${groups.length + 1}`, kind: "examples", label: "Examples", parent: parent.id, members: members.map(member => member.id), sourceBounds: { top: members[0].sourceBounds.top, left: Math.min(...members.map(member => member.sourceBounds.left)), bottom: members.at(-1)!.sourceBounds.bottom, right: Math.max(...members.map(member => member.sourceBounds.right)) } });
  }
  const nodeOrder = new Map(nodes.map((node, index) => [node.id, index]));
  edges.sort((a, b) => (nodeOrder.get(a.source)! - nodeOrder.get(b.source)!) || (nodeOrder.get(a.target)! - nodeOrder.get(b.target)!));
  const diagnostics = nodes.length === 0
    ? [{ code: "NO_NODES", message: "No supported diagram nodes were found.", severity: "warning" as const }]
    : [];
  if (arrows.length > edges.filter(edge => edge.arrow === "normal").length) diagnostics.push({ code: "UNRESOLVED_ARROW", message: "One or more arrows could not be connected to two nodes.", severity: "warning" as const });
  return { version: "1" as const, nodes, edges, groups, diagnostics, source };
}
