import { CreationTool } from './CreationTool.js';
import { ArcShape } from '../shapes/ArcShape.js';

export class ArcTool extends CreationTool {
  constructor(app) {
    super(app);
  }

  createShape(x, y, w, h) {
    const defaults = this.app.getDefaultProps('arc');
    return new ArcShape({ x, y, width: w, height: h, ...defaults });
  }
}
