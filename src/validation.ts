import type { Bounds, Diagram, Point, PrimitiveDocument, ValidationIssue } from "./types.js";

const issue = (code: string, path: string, message: string): ValidationIssue => ({ code, path, message });
const validPoint = (point: Point) => Number.isInteger(point.row) && point.row >= 0 && Number.isInteger(point.col) && point.col >= 0;
const validBounds = (bounds: Bounds) =>
  validPoint({ row: bounds.top, col: bounds.left }) &&
  validPoint({ row: bounds.bottom, col: bounds.right }) &&
  bounds.top <= bounds.bottom && bounds.left <= bounds.right;
const pointInBounds = (point: Point, bounds: Bounds) =>
  point.row >= bounds.top && point.row <= bounds.bottom && point.col >= bounds.left && point.col <= bounds.right;
const duplicateIds = (ids: string[]) => [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];

export function validatePrimitiveDocument(document: PrimitiveDocument): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (document.version !== "1") issues.push(issue("UNSUPPORTED_PRIMITIVE_VERSION", "version", `Unsupported PrimitiveDocument version ${String(document.version)}.`));
  const primitiveIds = document.items.map(item => item.id);
  for (const id of duplicateIds(primitiveIds)) issues.push(issue("DUPLICATE_PRIMITIVE_ID", "items", `Primitive id ${id} is not unique.`));
  const expectedByKind = {
    text: new Set(document.texts.map(item => item.id)),
    box: new Set(document.boxes.map(item => item.id)),
    arrow: new Set(document.arrows.map(item => item.id)),
    connector: new Set(document.connectors.map(item => item.id))
  };
  for (const [kind, entries] of Object.entries({ text: document.texts, box: document.boxes, arrow: document.arrows, connector: document.connectors })) {
    for (const id of duplicateIds(entries.map(entry => entry.id))) {
      issues.push(issue("DUPLICATE_PRIMITIVE_INDEX_ID", `${kind}s`, `${kind} primitive id ${id} is not unique.`));
    }
  }
  for (const [index, primitive] of document.items.entries()) {
    if (!expectedByKind[primitive.kind].has(primitive.id)) {
      issues.push(issue("PRIMITIVE_INDEX_MISMATCH", `items[${index}]`, `${primitive.id} is missing from the ${primitive.kind} index.`));
    }
    if (primitive.kind === "arrow") {
      if (!validPoint(primitive.point)) issues.push(issue("INVALID_POINT", `items[${index}].point`, "Arrow point must use non-negative integer coordinates."));
    } else if (!validBounds(primitive.bounds)) {
      issues.push(issue("INVALID_BOUNDS", `items[${index}].bounds`, "Primitive bounds must be ordered non-negative integer coordinates."));
    }
  }
  const itemIds = new Set(primitiveIds);
  for (const [kind, entries] of Object.entries({ text: document.texts, box: document.boxes, arrow: document.arrows, connector: document.connectors })) {
    for (const [index, entry] of entries.entries()) if (!itemIds.has(entry.id)) {
      issues.push(issue("PRIMITIVE_INDEX_MISMATCH", `${kind}s[${index}]`, `${entry.id} is missing from items.`));
    }
  }
  for (const [connectorIndex, connector] of document.connectors.entries()) {
    if (!connector.cells.length) issues.push(issue("EMPTY_CONNECTOR", `connectors[${connectorIndex}].cells`, "Connector components must contain at least one cell."));
    for (const [cellIndex, cell] of connector.cells.entries()) {
      if (!validPoint(cell.point) || !pointInBounds(cell.point, connector.bounds)) {
        issues.push(issue("CONNECTOR_POINT_OUT_OF_BOUNDS", `connectors[${connectorIndex}].cells[${cellIndex}].point`, "Connector cells must lie inside connector bounds."));
      }
    }
    for (const [pointKind, points] of Object.entries({ endpoints: connector.endpoints, junctions: connector.junctions })) {
      for (const [pointIndex, point] of points.entries()) if (!validPoint(point) || !pointInBounds(point, connector.bounds)) {
        issues.push(issue("CONNECTOR_POINT_OUT_OF_BOUNDS", `connectors[${connectorIndex}].${pointKind}[${pointIndex}]`, `Connector ${pointKind} must lie inside connector bounds.`));
      }
    }
    for (const id of duplicateIds(connector.paths.map(path => path.id))) {
      issues.push(issue("DUPLICATE_CONNECTOR_PATH_ID", `connectors[${connectorIndex}].paths`, `Connector path id ${id} is not unique.`));
    }
    for (const [pathIndex, path] of connector.paths.entries()) {
      if (!path.points.length) issues.push(issue("EMPTY_CONNECTOR_PATH", `connectors[${connectorIndex}].paths[${pathIndex}]`, "Connector paths must contain at least one point."));
      for (const [pointIndex, point] of path.points.entries()) if (!validPoint(point) || !pointInBounds(point, connector.bounds)) {
        issues.push(issue("CONNECTOR_POINT_OUT_OF_BOUNDS", `connectors[${connectorIndex}].paths[${pathIndex}].points[${pointIndex}]`, "Connector path points must lie inside connector bounds."));
      }
    }
  }
  return issues;
}

export function validateDiagram(diagram: Diagram, primitives?: PrimitiveDocument): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (diagram.version !== "2") issues.push(issue("UNSUPPORTED_DIAGRAM_VERSION", "version", `Unsupported Diagram version ${String(diagram.version)}.`));
  const sourceWidth = Math.max(0, ...diagram.source.lines.map(line => [...line].length));
  if (diagram.source.height !== diagram.source.lines.length || diagram.source.width !== sourceWidth) {
    issues.push(issue("INVALID_SOURCE_DIMENSIONS", "source", "Source dimensions must match the normalized source lines."));
  }
  const allIds = [...diagram.nodes.map(node => node.id), ...diagram.edges.map(edge => edge.id), ...diagram.groups.map(group => group.id)];
  for (const id of duplicateIds(allIds)) issues.push(issue("DUPLICATE_DIAGRAM_ID", "diagram", `Diagram id ${id} is not unique.`));
  const nodeIds = new Set(diagram.nodes.map(node => node.id));
  const primitiveIds = primitives ? new Set(primitives.items.map(item => item.id)) : undefined;
  for (const [index, node] of diagram.nodes.entries()) if (!validBounds(node.sourceBounds)) {
    issues.push(issue("INVALID_BOUNDS", `nodes[${index}].sourceBounds`, "Node bounds must be ordered non-negative integer coordinates."));
  }
  for (const [index, edge] of diagram.edges.entries()) {
    if (!nodeIds.has(edge.source)) issues.push(issue("MISSING_EDGE_SOURCE", `edges[${index}].source`, `Unknown node ${edge.source}.`));
    if (!nodeIds.has(edge.target)) issues.push(issue("MISSING_EDGE_TARGET", `edges[${index}].target`, `Unknown node ${edge.target}.`));
    if (edge.geometry.kind !== "polyline" || edge.geometry.points.length < 2 || edge.geometry.points.some(point => !validPoint(point))) {
      issues.push(issue("INVALID_EDGE_GEOMETRY", `edges[${index}].geometry`, "Polyline geometry requires at least two non-negative integer points."));
    }
    if (!edge.provenance.recognizer || !edge.provenance.evidence.length || edge.provenance.confidence < 0 || edge.provenance.confidence > 1) {
      issues.push(issue("INVALID_PROVENANCE", `edges[${index}].provenance`, "Provenance requires a recognizer and confidence between 0 and 1."));
    }
    if (primitiveIds && !edge.provenance.evidence.some(id => primitiveIds.has(id))) {
      issues.push(issue("UNTRACEABLE_EDGE_EVIDENCE", `edges[${index}].provenance.evidence`, "Every edge must reference at least one source primitive."));
    }
  }
  for (const [index, group] of diagram.groups.entries()) {
    if (group.parent && !nodeIds.has(group.parent)) issues.push(issue("MISSING_GROUP_PARENT", `groups[${index}].parent`, `Unknown node ${group.parent}.`));
    for (const [memberIndex, member] of group.members.entries()) if (!nodeIds.has(member)) {
      issues.push(issue("MISSING_GROUP_MEMBER", `groups[${index}].members[${memberIndex}]`, `Unknown node ${member}.`));
    }
    if (!group.provenance.recognizer || !group.provenance.evidence.length || group.provenance.confidence < 0 || group.provenance.confidence > 1) {
      issues.push(issue("INVALID_PROVENANCE", `groups[${index}].provenance`, "Provenance requires a recognizer and confidence between 0 and 1."));
    }
  }
  return issues;
}

export class ParseInvariantError extends Error {
  constructor(readonly issues: ValidationIssue[]) {
    super(`Parser produced ${issues.length} invalid artifact${issues.length === 1 ? "" : "s"}.`);
    this.name = "ParseInvariantError";
  }
}

export function assertValidParseArtifacts(primitives: PrimitiveDocument, diagram: Diagram): void {
  const issues = [...validatePrimitiveDocument(primitives), ...validateDiagram(diagram, primitives)];
  if (issues.length) throw new ParseInvariantError(issues);
}
