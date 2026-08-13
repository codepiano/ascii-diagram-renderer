import type { Bounds, Point } from "./types.js";
import { SourceDocument } from "./source.js";

export class CharacterGrid extends SourceDocument {

  isBlank(point: Point): boolean { return this.char(point).trim() === ""; }

  bounds(points: Point[]): Bounds {
    return {
      top: Math.min(...points.map(p => p.row)), left: Math.min(...points.map(p => p.col)),
      bottom: Math.max(...points.map(p => p.row)), right: Math.max(...points.map(p => p.col))
    };
  }
}
