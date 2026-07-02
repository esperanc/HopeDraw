import { AddShapeCommand } from '../core/CommandManager.js';
import { PathShape } from '../shapes/PathShape.js';

const CLOSE_THRESH_PX = 12;  // screen-px within which clicking near the start closes the path

/**
 * Pen / path drawing tool.
 *
 * Click          → add sharp anchor (line segment)
 * Click + drag   → add smooth anchor (cubic Bézier with symmetric handles)
 * Near start pt  → close path and finish
 * Escape / Enter → finish open path and switch to select
 * Backspace      → remove the last-placed anchor
 * Double-click   → finish path
 */
export class PathTool {
  constructor(app) {
    this.app = app;
    this._reset();
    this._onKey = this._onKey.bind(this);
  }

  _reset() {
    this._shape      = null;
    this._dragging   = false;
    this._dragIdx    = null;
    this._dragStart  = null;
    this._previewEl  = null;    // dashed line from last node to cursor
    this._anchorEls  = [];      // visual squares shown while drawing in progress
  }

  activate() {
    this.app.canvas.svg.style.cursor = 'crosshair';
    document.addEventListener('keydown', this._onKey, true);
  }

  deactivate() {
    document.removeEventListener('keydown', this._onKey, true);
    this._finishPath();
  }

  // ─── Pointer events ────────────────────────────────────────────────────────

  onPointerDown(wx, wy, e) {
    if (e.button !== 0) return;
    wx = this.app.canvas.snap(wx);
    wy = this.app.canvas.snap(wy);

    // Start a new path if one isn't open yet
    if (!this._shape) {
      const d = this.app.getDefaultProps('path');
      this._shape = new PathShape({
        fill:        d.fill        ?? '#4a9eff',
        stroke:      d.stroke      ?? '#1a1a2e',
        strokeWidth: d.strokeWidth ?? 2,
        layerId:     this.app.layers.getActiveLayer()?.id,
      });
      this._shape.mount(this.app.canvas.shapesLayer);
    }

    // If the user clicks near the first node → close path
    if (this._shape.nodes.length > 1) {
      const first  = this._shape.nodes[0];
      const thresh = CLOSE_THRESH_PX / this.app.canvas.zoom;
      if (Math.hypot(wx - first.x, wy - first.y) <= thresh) {
        this._shape.closed = true;
        this._finishPath();
        return;
      }
    }

    // Add a new anchor. It starts sharp; dragging just after this click is
    // what marks it smooth (see onPointerMove). Handle geometry is derived
    // from the neighbouring anchors, not from the drag vector.
    const node = { x: wx, y: wy, cInX: null, cInY: null, cOutX: null, cOutY: null, smooth: false };
    this._shape.nodes.push(node);
    const newIdx = this._shape.nodes.length - 1;
    // The anchor placed just before this one now has a concrete "next" point,
    // so finalise its handles against the real neighbour instead of the cursor.
    if (newIdx > 0) this._applySmoothHandles(newIdx - 1);
    this._dragIdx   = newIdx;
    this._dragStart = { wx, wy };
    this._dragging  = true;
    this._shape.render();
    this._addAnchorDot(wx, wy);
    this.app.canvas.svg.setPointerCapture?.(e.pointerId);
  }

  onPointerMove(wx, wy, e) {
    wx = this.app.canvas.snap(wx);
    wy = this.app.canvas.snap(wy);

    // Dragging just after placing an anchor marks it as smooth.
    if (this._dragging && this._dragIdx !== null) {
      const dx = wx - this._dragStart.wx;
      const dy = wy - this._dragStart.wy;
      if (Math.hypot(dx, dy) > 4 / this.app.canvas.zoom) {
        this._shape.nodes[this._dragIdx].smooth = true;
      }
    }

    // The last anchor's "next" point is wherever the cursor is now, so its
    // handles (a = cIn and b = cOut) must be recomputed on every move.
    const lastIdx = this._shape ? this._shape.nodes.length - 1 : -1;
    if (lastIdx >= 0 && this._shape.nodes[lastIdx].smooth) {
      this._applySmoothHandles(lastIdx, { x: wx, y: wy });
      this._shape.render();
    }

    this._updatePreview(wx, wy);
  }

  /**
   * Recompute the Bézier handles of a smooth anchor from its neighbours.
   *
   * For anchor q with previous anchor p and next point r:
   *   tangent  t   = normalize(r − p)              (a, q, b are co-linear)
   *   cIn (a)      = q − ½·|q − p| · t
   *   cOut (b)     = q + ½·|r − q| · t
   *
   * Endpoints of an open path have a single neighbour and get a one-sided
   * handle; a closed path wraps around so every anchor is interior.
   *
   * @param idx        index of the anchor to update
   * @param nextOverride optional {x,y} to use as r (the live cursor position)
   */
  _applySmoothHandles(idx, nextOverride = null) {
    const n = this._shape.nodes;
    const q = n[idx];
    if (!q || !q.smooth) return;
    const total = n.length;
    const closed = this._shape.closed;

    const prev = idx > 0        ? n[idx - 1] : (closed ? n[total - 1] : null);
    const next = nextOverride ?? (idx < total - 1 ? n[idx + 1] : (closed ? n[0] : null));

    const clear = () => { q.cInX = q.cInY = q.cOutX = q.cOutY = null; };

    if (prev && next) {
      let tx = next.x - prev.x, ty = next.y - prev.y;
      const tl = Math.hypot(tx, ty);
      if (tl < 1e-6) { clear(); return; }
      tx /= tl; ty /= tl;
      const dIn  = 0.5 * Math.hypot(q.x - prev.x, q.y - prev.y);
      const dOut = 0.5 * Math.hypot(next.x - q.x, next.y - q.y);
      q.cInX  = q.x - tx * dIn;  q.cInY  = q.y - ty * dIn;
      q.cOutX = q.x + tx * dOut; q.cOutY = q.y + ty * dOut;
    } else if (next) {
      // First anchor of an open path: only an outgoing handle toward next.
      let tx = next.x - q.x, ty = next.y - q.y;
      const tl = Math.hypot(tx, ty);
      if (tl < 1e-6) { clear(); return; }
      const dOut = 0.5 * tl;
      q.cOutX = q.x + (tx / tl) * dOut; q.cOutY = q.y + (ty / tl) * dOut;
      q.cInX = null; q.cInY = null;
    } else if (prev) {
      // Last anchor of a finished open path: only an incoming handle.
      let tx = q.x - prev.x, ty = q.y - prev.y;
      const tl = Math.hypot(tx, ty);
      if (tl < 1e-6) { clear(); return; }
      const dIn = 0.5 * tl;
      q.cInX = q.x - (tx / tl) * dIn; q.cInY = q.y - (ty / tl) * dIn;
      q.cOutX = null; q.cOutY = null;
    } else {
      clear();
    }
  }

  /** Recompute every smooth anchor against its real neighbours before commit. */
  _finalizeSmoothHandles() {
    const n = this._shape.nodes;
    for (let i = 0; i < n.length; i++) this._applySmoothHandles(i);
  }

  onPointerUp(wx, wy, e) {
    this._dragging = false;
    this._dragStart = null;
  }

  onDblClick(wx, wy, e) {
    // The dblclick fires after a second pointerdown that already added a node.
    // Remove the duplicate last node if it's essentially the same as the one before.
    if (this._shape && this._shape.nodes.length > 1) {
      const n    = this._shape.nodes;
      const last = n[n.length - 1], prev = n[n.length - 2];
      if (Math.hypot(last.x - prev.x, last.y - prev.y) < 6 / this.app.canvas.zoom) {
        n.pop();
        const dot = this._anchorEls.pop();
        if (dot) dot.remove();
      }
    }
    this._finishPath();
  }

  // ─── Keyboard ─────────────────────────────────────────────────────────────

  _onKey(e) {
    if (e.key === 'Escape' || e.key === 'Enter') {
      e.preventDefault();
      this._finishPath();
    }
    if (e.key === 'Backspace' && this._shape?.nodes.length) {
      e.preventDefault();
      this._shape.nodes.pop();
      const dot = this._anchorEls.pop();
      if (dot) dot.remove();
      if (!this._shape.nodes.length) { this._cancelPath(); return; }
      this._shape.render();
    }
  }

  // ─── Preview helpers ──────────────────────────────────────────────────────

  _updatePreview(wx, wy) {
    if (!this._shape?.nodes.length) { this._clearPreview(); return; }
    const last = this._shape.nodes[this._shape.nodes.length - 1];
    const z    = this.app.canvas.zoom;
    if (!this._previewEl) {
      this._previewEl = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      this._previewEl.setAttribute('stroke', 'rgba(108,99,255,0.7)');
      this._previewEl.setAttribute('pointer-events', 'none');
      this.app.canvas.handlesLayer.appendChild(this._previewEl);
    }
    this._previewEl.setAttribute('stroke-width', 1.5 / z);
    this._previewEl.setAttribute('stroke-dasharray', `${4 / z} ${3 / z}`);
    this._previewEl.setAttribute('x1', last.x);
    this._previewEl.setAttribute('y1', last.y);
    this._previewEl.setAttribute('x2', wx);
    this._previewEl.setAttribute('y2', wy);
  }

  _clearPreview() {
    if (this._previewEl) { this._previewEl.remove(); this._previewEl = null; }
    this._anchorEls.forEach(el => el.remove());
    this._anchorEls = [];
  }

  _addAnchorDot(wx, wy) {
    const z = this.app.canvas.zoom;
    const s = 6 / z;
    const el = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    el.setAttribute('x', wx - s / 2);
    el.setAttribute('y', wy - s / 2);
    el.setAttribute('width', s);
    el.setAttribute('height', s);
    el.setAttribute('fill', '#fff');
    el.setAttribute('stroke', '#6c63ff');
    el.setAttribute('stroke-width', 1.5 / z);
    el.setAttribute('pointer-events', 'none');
    this.app.canvas.handlesLayer.appendChild(el);
    this._anchorEls.push(el);
  }

  // ─── Path completion ──────────────────────────────────────────────────────

  _finishPath() {
    this._clearPreview();
    if (!this._shape) return;
    if (this._shape.nodes.length < 2) { this._cancelPath(); return; }

    this._finalizeSmoothHandles();
    const shape = this._shape;
    this._reset();
    shape.recomputeBBox(); // MUST compute initial unrotated bounding box before mounting
    shape.unmount();
    this.app.commands.execute(new AddShapeCommand(this.app, shape));
    this.app.selection.select(shape.id);
    this.app.finishCreation();
  }

  _cancelPath() {
    this._clearPreview();
    if (this._shape) { this._shape.unmount(); }
    this._reset();
    this.app.setActiveTool('select');
  }
}
