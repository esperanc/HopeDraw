import { CreationTool } from './CreationTool.js';
import { RectShape } from '../shapes/RectShape.js';
export class RectTool extends CreationTool {
  constructor(app) { super(app); }
  createShape(x, y, w, h) {
    const defaults = this.app.getDefaultProps('rect');
    return new RectShape({ x, y, width: w, height: h, ...defaults });
  }
}
