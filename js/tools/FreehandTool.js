import { AddShapeCommand } from '../core/CommandManager.js';
import { PathShape } from '../shapes/PathShape.js';

// ─── 1€ filter ────────────────────────────────────────────────────────────────
// Géry Casiez, Nicolas Roussel, Daniel Vogel — "1€ Filter: A Simple Speed-based
// Low-pass Filter for Noisy Input in Interactive Systems" (CHI 2012).
// Adaptive low-pass: heavy smoothing when the pen moves slowly (kills jitter),
// low lag when it moves fast (keeps the gesture responsive).

class LowPass {
  constructor() { this.y = null; this.s = null; }
  filter(x, a) {
    this.s = (this.s === null) ? x : a * x + (1 - a) * this.s;
    this.y = x;
    return this.s;
  }
  get hasLast() { return this.s !== null; }
}

class OneEuro {
  constructor(minCutoff = 1.0, beta = 0.0, dCutoff = 1.0) {
    this.minCutoff = minCutoff;
    this.beta      = beta;
    this.dCutoff   = dCutoff;
    this._x  = new LowPass();
    this._dx = new LowPass();
    this._lastX = null;
    this._lastT = null;
  }

  static _alpha(cutoff, dt) {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  /** @param x raw value  @param t timestamp in ms */
  filter(x, t) {
    if (this._lastT === null) {
      this._lastT = t;
      this._lastX = x;
      this._x.filter(x, 1);
      return x;
    }
    let dt = (t - this._lastT) / 1000;
    if (!(dt > 0)) dt = 1 / 60;

    const dx  = (x - this._lastX) / dt;
    const edx = this._dx.filter(dx, OneEuro._alpha(this.dCutoff, dt));
    const cutoff = this.minCutoff + this.beta * Math.abs(edx);
    const fx  = this._x.filter(x, OneEuro._alpha(cutoff, dt));

    this._lastX = x;
    this._lastT = t;
    return fx;
  }
}

/**
 * Freehand drawing tool.
 *
 * Raw pointer samples are smoothed on the fly by a per-axis 1€ filter, then on
 * release the polyline is simplified (Ramer–Douglas–Peucker) and given
 * auto-smooth Bézier handles, producing a compact, node-editable PathShape
 * (uniform stroke width). Configurable via app.defaultProps.freehand.
 */
export class FreehandTool {
  constructor(app) {
    this.app = app;
    this._reset();
  }

  _reset() {
    this._shape  = null;
    this._points = [];   // filtered {x, y}
    this._fx = null;
    this._fy = null;
    this._drawing = false;
  }

  activate()   { this.app.canvas.svg.style.cursor = 'crosshair'; }
  deactivate() { this._cancel(); }

  _brush() {
    const d = this.app.defaultProps.freehand || {};
    return {
      stroke:      d.stroke      ?? '#1a1a2e',
      strokeWidth: d.strokeWidth ?? 3,
      minCutoff:   d.minCutoff   ?? 1.5,
      beta:        d.beta        ?? 0.02,
      cornerAngle: d.cornerAngle ?? 30,   // turns sharper than this stay crisp
    };
  }

  // ─── Pointer events ─────────────────────────────────────────────────────────

  onPointerDown(wx, wy, e) {
    if (e.button !== 0) return;
    const b = this._brush();
    // Freehand deliberately ignores grid snapping — snapping would shred the
    // stroke into staircases.
    this._fx = new OneEuro(b.minCutoff, b.beta);
    this._fy = new OneEuro(b.minCutoff, b.beta);

    const t = e.timeStamp || performance.now();
    const px = this._fx.filter(wx, t);
    const py = this._fy.filter(wy, t);
    this._points = [{ x: px, y: py }];

    this._shape = new PathShape({
      fill:        'none',
      stroke:      b.stroke,
      strokeWidth: b.strokeWidth,
      layerId:     this.app.layers.getActiveLayer()?.id,
      nodes:       [this._node(px, py)],
    });
    this._shape.mount(this.app.canvas.shapesLayer);
    this._drawing = true;
    this.app.canvas.svg.setPointerCapture?.(e.pointerId);
  }

  onPointerMove(wx, wy, e) {
    if (!this._drawing || !this._shape) return;
    const t = e.timeStamp || performance.now();
    const px = this._fx.filter(wx, t);
    const py = this._fy.filter(wy, t);

    // Skip samples that barely moved to keep the node list lean.
    const last = this._points[this._points.length - 1];
    const minStep = 0.75 / (this.app.canvas.zoom || 1);
    if (last && Math.hypot(px - last.x, py - last.y) < minStep) return;

    this._points.push({ x: px, y: py });
    this._shape.nodes.push(this._node(px, py));
    this._shape.render();
  }

  onPointerUp(wx, wy, e) {
    if (!this._drawing) return;
    this._drawing = false;
    this._finish();
  }

  // ─── Finalisation ───────────────────────────────────────────────────────────

  _finish() {
    const shape = this._shape;
    if (!shape) { this._reset(); return; }

    // Simplify, then smooth. Epsilon is in world units, scaled by zoom so the
    // fidelity is consistent on screen regardless of zoom level.
    const eps = 1.2 / (this.app.canvas.zoom || 1);
    const simplified = this._rdp(this._points, eps);

    if (simplified.length < 2) { shape.unmount(); this._reset(); return; }

    shape.nodes = simplified.map(p => this._node(p.x, p.y));
    this._applySmoothing(shape.nodes, this._brush().cornerAngle);

    shape.recomputeBBox();
    shape.unmount();
    this._reset();

    this.app.commands.execute(new AddShapeCommand(this.app, shape));
    this.app.selection.select(shape.id);
    this.app.finishCreation();
  }

  _cancel() {
    if (this._shape) this._shape.unmount();
    this._reset();
  }

  _node(x, y) {
    return { x, y, cInX: null, cInY: null, cOutX: null, cOutY: null, smooth: false };
  }

  /**
   * Give gentle interior nodes auto-smooth Bézier handles: the tangent at q is
   * parallel to (next − prev) and each handle reaches half-way to its
   * neighbour. Nodes where the stroke turns sharply (more than cornerAngle
   * degrees) are left as crisp corners, and endpoints stay sharp too.
   * (Same handle scheme as the pen tool.)
   */
  _applySmoothing(nodes, cornerAngleDeg = 30) {
    const cornerCos = Math.cos((cornerAngleDeg * Math.PI) / 180);
    for (let i = 1; i < nodes.length - 1; i++) {
      const q = nodes[i], p = nodes[i - 1], r = nodes[i + 1];
      let ix = q.x - p.x, iy = q.y - p.y;   // incoming direction
      let ox = r.x - q.x, oy = r.y - q.y;   // outgoing direction
      const il = Math.hypot(ix, iy), ol = Math.hypot(ox, oy);
      if (il < 1e-6 || ol < 1e-6) continue;
      ix /= il; iy /= il; ox /= ol; oy /= ol;

      // Sharp turn → keep it as a corner (no handles).
      if (ix * ox + iy * oy < cornerCos) {
        q.smooth = false;
        q.cInX = q.cInY = q.cOutX = q.cOutY = null;
        continue;
      }

      let tx = r.x - p.x, ty = r.y - p.y;
      const tl = Math.hypot(tx, ty);
      if (tl < 1e-6) continue;
      tx /= tl; ty /= tl;
      q.cInX  = q.x - tx * 0.5 * il; q.cInY  = q.y - ty * 0.5 * il;
      q.cOutX = q.x + tx * 0.5 * ol; q.cOutY = q.y + ty * 0.5 * ol;
      q.smooth = true;
    }
  }

  /** Ramer–Douglas–Peucker polyline simplification. */
  _rdp(pts, eps) {
    if (pts.length < 3) return pts.slice();
    const keep = new Array(pts.length).fill(false);
    keep[0] = keep[pts.length - 1] = true;

    const stack = [[0, pts.length - 1]];
    while (stack.length) {
      const [a, b] = stack.pop();
      let maxD = -1, idx = -1;
      for (let i = a + 1; i < b; i++) {
        const d = this._perpDist(pts[i], pts[a], pts[b]);
        if (d > maxD) { maxD = d; idx = i; }
      }
      if (maxD > eps && idx !== -1) {
        keep[idx] = true;
        stack.push([a, idx], [idx, b]);
      }
    }
    return pts.filter((_, i) => keep[i]);
  }

  _perpDist(p, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) return Math.hypot(p.x - a.x, p.y - a.y);
    // |cross product| / |ab|
    return Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / len;
  }
}
