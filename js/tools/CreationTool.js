import { AddShapeCommand } from '../core/CommandManager.js';

/**
 * Base class for all shape-creation tools.
 * Subclasses provide: createShape(x, y, w, h), shapeType, cursor.
 */
export class CreationTool {
  constructor(app) {
    this.app   = app;
    this._down = false;
    this._start = null;
    this._preview = null;
    this.cursor = 'crosshair';
  }

  activate() { this.app.canvas.svg.style.cursor = this.cursor; }
  deactivate() { this._cancelPreview(); }

  onPointerDown(wx, wy, e) {
    if (e.button !== 0) return;
    wx = this.app.canvas.snap(wx);
    wy = this.app.canvas.snap(wy);
    this._down  = true;
    this._start = { wx, wy };
    this._preview = this.createShape(wx, wy, 1, 1);
    this._preview.layerId = this.app.layers.getActiveLayer()?.id;
    this._preview.mount(this.app.canvas.shapesLayer);
    this.app.canvas.svg.setPointerCapture?.(e.pointerId);
  }

  onPointerMove(wx, wy, e) {
    if (!this._down || !this._preview) return;
    wx = this.app.canvas.snap(wx);
    wy = this.app.canvas.snap(wy);
    const { wx: sx, wy: sy } = this._start;
    const x = Math.min(wx, sx), y = Math.min(wy, sy);
    const w = Math.max(2, Math.abs(wx - sx));
    const h = Math.max(2, Math.abs(wy - sy));
    this._updatePreview(this._preview, x, y, w, h, wx, wy);
  }

  onPointerUp(wx, wy, e) {
    if (!this._down || !this._preview) return;
    this._down = false;
    wx = this.app.canvas.snap(wx);
    wy = this.app.canvas.snap(wy);
    const { wx: sx, wy: sy } = this._start;
    const x = Math.min(wx, sx), y = Math.min(wy, sy);
    const w = Math.max(10, Math.abs(wx - sx));
    const h = Math.max(10, Math.abs(wy - sy));
    this._updatePreview(this._preview, x, y, w, h, wx, wy);

    const shape = this._preview;
    shape.unmount(); // temporarily remove for clean command execution
    this._preview = null;

    this.app.commands.execute(new AddShapeCommand(this.app, shape));
    this.app.selection.select(shape.id);
    // Switch back to select tool
    this.app.setActiveTool('select');
  }

  _updatePreview(shape, x, y, w, h, wx2, wy2) {
    shape.x = x; shape.y = y; shape.width = w; shape.height = h;
    shape.render();
  }

  _cancelPreview() {
    if (this._preview) { this._preview.unmount(); this._preview = null; }
    this._down = false;
  }

  /** Subclass returns a new Shape instance */
  createShape(x, y, w, h) { throw new Error('createShape() is abstract'); }
}
