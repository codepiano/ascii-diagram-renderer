export * from "./core.js";
export { renderSvg, renderSvgV2, renderLayoutedSvg } from "./svg.js";

import { parseAscii, parseAsciiV2 } from "./core.js";
import { renderSvg } from "./svg.js";
import type { RenderOptions } from "./types.js";

export function asciiToSvg(input: string, options?: RenderOptions): string {
  const parsed = parseAscii(input, { detection: "strict" });
  if (parsed.classification.kind !== "diagram") return "";
  return renderSvg(parsed.diagram, options);
}

export function asciiToSvgV2(input: string, options?: RenderOptions): string {
  const parsed = parseAsciiV2(input, { detection: "strict" });
  if (parsed.classification.kind !== "diagram") return "";
  return renderSvg(parsed.diagram, options);
}
