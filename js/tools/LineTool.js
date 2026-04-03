import { AddShapeCommand } from '../core/CommandManager.js';
import { LineShape } from '../shapes/LineShape.js';

/**
 * Line/Arrow tool – click to set start point, drag to set end point.
 */
export class LineTool {
  constructor(app) {
    this.app = app;
    this._down = false;
    this._preview = null;
    this.cursor = 'crosshair';
  }

  activate() { this.app.canvas.svg.style.cursor = this.cursor; }
  deactivate() { if (this._preview) { this._preview.unmount(); this._preview = null; } }

  onPointerDown(wx, wy, e) {
    if (e.button !== 0) return;
    wx = this.app.canvas.snap(wx);
    wy = this.app.canvas.snap(wy);
    this._down = true;
    const d = this.app.getDefaultProps('line');
    this._preview = new LineShape({
      x: wx, y: wy, x2: wx, y2: wy,
      stroke: d.stroke ?? '#1a1a2e', strokeWidth: d.strokeWidth ?? 2,
      arrowStart: d.arrowStart ?? 'none',
      arrowEnd: d.arrowEnd ?? 'none',
      lineMode: d.lineMode ?? 'straight',
      layerId: this.app.layers.getActiveLayer()?.id,
    });
    this._preview.mount(this.app.canvas.shapesLayer);
    this.app.canvas.svg.setPointerCapture?.(e.pointerId);
  }

  onPointerMove(wx, wy, e) {
    if (!this._down || !this._preview) return;
    wx = this.app.canvas.snap(wx);
    wy = this.app.canvas.snap(wy);
    this._preview.x2 = wx;
    this._preview.y2 = wy;
    this._preview.render();
  }

  onPointerUp(wx, wy, e) {
    if (!this._down || !this._preview) return;
    wx = this.app.canvas.snap(wx);
    wy = this.app.canvas.snap(wy);
    this._down = false;
    const shape = this._preview;
    shape.unmount();
    this._preview = null;
    this.app.commands.execute(new AddShapeCommand(this.app, shape));
    this.app.selection.select(shape.id);
    this.app.setActiveTool('select');
  }
}
