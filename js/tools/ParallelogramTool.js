import { CreationTool } from './CreationTool.js';
import { ParallelogramShape } from '../shapes/ParallelogramShape.js';
export class ParallelogramTool extends CreationTool {
  constructor(app) { super(app); }
  createShape(x, y, w, h) {
    const defaults = this.app.getDefaultProps('parallelogram');
    return new ParallelogramShape({ x, y, width: w, height: h, ...defaults });
  }
}
