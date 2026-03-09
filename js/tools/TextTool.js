import { AddShapeCommand } from '../core/CommandManager.js';
import { TextShape } from '../shapes/TextShape.js';

/**
 * Text tool – click+drag to define a text area, then auto-enter edit mode.
 */
export class TextTool {
  constructor(app) {
    this.app = app;
    this._down = false;
    this._start = null;
    this._preview = null;
    this.cursor = 'text';
  }

  activate() { this.app.canvas.svg.style.cursor = this.cursor; }
  deactivate() { if (this._preview) { this._preview.unmount(); this._preview = null; } }

  onPointerDown(wx, wy, e) {
    if (e.button !== 0) return;
    this._down  = true;
    this._start = { wx, wy };
    const d = this.app.getDefaultProps('text');
    this._preview = new TextShape({
      x: wx, y: wy, width: 10, height: 30,
      content: '',
      layerId: this.app.layers.getActiveLayer()?.id,
      ...d
    });
    this._preview.mount(this.app.canvas.shapesLayer);
    this.app.canvas.svg.setPointerCapture?.(e.pointerId);
  }

  onPointerMove(wx, wy, e) {
    if (!this._down || !this._preview) return;
    const { wx: sx, wy: sy } = this._start;
    this._preview.x = Math.min(wx, sx);
    this._preview.y = Math.min(wy, sy);
    this._preview.width  = Math.max(20, Math.abs(wx - sx));
    this._preview.height = Math.max(20, Math.abs(wy - sy));
    this._preview.render();
  }

  onPointerUp(wx, wy, e) {
    if (!this._down || !this._preview) return;
    this._down = false;
    const { wx: sx, wy: sy } = this._start;
    const w = Math.max(80, Math.abs(wx - sx));
    const h = Math.max(30, Math.abs(wy - sy));
    this._preview.x = Math.min(wx, sx);
    this._preview.y = Math.min(wy, sy);
    this._preview.width  = w;
    this._preview.height = h;
    this._preview.content = '<p>Text</p>';
    this._preview.render();

    const shape = this._preview;
    shape.unmount();
    this._preview = null;
    this.app.commands.execute(new AddShapeCommand(this.app, shape));
    this.app.selection.select(shape.id);
    this.app.setActiveTool('select');
    // Auto enter edit mode
    setTimeout(() => {
      shape.enterEditMode();
      const handler = (ev) => {
        if (!shape.el?.contains(ev.target)) {
          shape.exitEditMode();
          document.removeEventListener('pointerdown', handler, true);
          this.app.bus.emit('shape-updated', { shape });
        }
      };
      document.addEventListener('pointerdown', handler, true);
    }, 50);
  }
}
