export * from "./core.js";
export { renderSvg } from "./svg.js";

import { parseAscii } from "./core.js";
import { renderSvg } from "./svg.js";
import type { RenderOptions } from "./types.js";

export function asciiToSvg(input: string, options?: RenderOptions): string {
  const parsed = parseAscii(input, { detection: "strict" });
  if (parsed.classification.kind !== "diagram") return "";
  return renderSvg(parsed.diagram, options);
}
