export class HandTool {
  constructor(app) {
    this.app = app;
  }

  activate() {
    this.app.canvas.svg.style.cursor = 'grab';
  }

  deactivate() {
    this.app.canvas.svg.style.cursor = '';
  }

  onPointerDown(x, y, e) {
    if (e.button !== 0) return;
    e.preventDefault();
    this._panning = true;
    this._lastPan = { x: e.clientX, y: e.clientY };
    this.app.canvas.svg.style.cursor = 'grabbing';
    this.app.canvas.svg.setPointerCapture(e.pointerId);
  }

  onPointerMove(x, y, e) {
    if (!this._panning) return;
    this.app.canvas.panX += e.clientX - this._lastPan.x;
    this.app.canvas.panY += e.clientY - this._lastPan.y;
    this._lastPan = { x: e.clientX, y: e.clientY };
    this.app.canvas._updateTransform();
  }

  onPointerUp(x, y, e) {
    if (!this._panning) return;
    this._panning = false;
    this._lastPan = null;
    this.app.canvas.svg.style.cursor = 'grab';
    if (this.app.canvas.svg.hasPointerCapture(e.pointerId)) {
      this.app.canvas.svg.releasePointerCapture(e.pointerId);
    }
  }
}
