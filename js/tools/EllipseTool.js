import { CreationTool } from './CreationTool.js';
import { EllipseShape } from '../shapes/EllipseShape.js';
export class EllipseTool extends CreationTool {
  constructor(app) { super(app); }
  createShape(x, y, w, h) {
    const defaults = this.app.getDefaultProps('ellipse');
    return new EllipseShape({ x, y, width: w, height: h, ...defaults });
  }
}
