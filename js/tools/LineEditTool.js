export class LineEditTool {
  constructor(app) {
    this.app            = app;
    this._shape         = null;
    this._handleEls     = [];
    this._dragging      = null;   // { handle, startWx, startWy, snap }
    this._snapshot      = null;   // state before drag
    this._onKey         = this._onKey.bind(this);
  }

  /** Called externally (from SelectTool.onDblClick) to enter point-edit mode */
  editShape(shape) {
    this._shape = shape;
    this.app.selection.clear();
    this.app.canvas.svg.style.cursor = 'default';
    document.addEventListener('keydown', this._onKey, true);
    this._rebuild();
  }

  activate() { /* no-op — entry is via editShape() */ }

  deactivate() {
    document.removeEventListener('keydown', this._onKey, true);
    this._clearHandles();
    // Return normal select-tool selection on the line we were editing
    if (this._shape) {
      this.app.selection.select(this._shape.id);
    }
    this._shape    = null;
    this._dragging = null;
    this._snapshot = null;
  }

  // ─── Keyboard ─────────────────────────────────────────────────────────────

  _onKey(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      this.app.setActiveTool('select');
    }
  }

  // ─── Handle rendering ─────────────────────────────────────────────────────

  _clearHandles() {
    this._handleEls.forEach(el => el.remove());
    this._handleEls = [];
  }

  /**
   * Compute the effective curve control point, matching LineShape.render().
   * Returns the stored value if set, otherwise the auto-offset midpoint.
   */
  _effectiveCp(s) {
    if (s.cpx !== null) return { cpx: s.cpx, cpy: s.cpy };
    const mx = (s.x + s.x2) / 2, my = (s.y + s.y2) / 2;
    const dl = Math.hypot(s.x2 - s.x, s.y2 - s.y) || 1;
    return {
      cpx: mx + (-(s.y2 - s.y) / dl) * dl * 0.25,
      cpy: my + ( (s.x2 - s.x) / dl) * dl * 0.25,
    };
  }

  _rebuild() {
    this._clearHandles();
    if (!this._shape) return;

    const ns    = 'http://www.w3.org/2000/svg';
    const z     = this.app.canvas.zoom;
    const hs    = 7 / z;   // anchor half-size
    const cpr   = 5 / z;   // control-point radius
    const sw    = 1.5 / z;
    const tsw   = 1 / z;
    const s     = this._shape;
    const layer = this.app.canvas.handlesLayer;

    const mk = (tag, attrs) => {
      const el = document.createElementNS(ns, tag);
      for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
      return el;
    };

    // ── Curve: Bézier control point & tangent guide lines ─────────────────
    if (s.lineMode === 'curve') {
      const { cpx, cpy } = this._effectiveCp(s);

      const l1 = mk('line', {
        x1: s.x, y1: s.y, x2: cpx, y2: cpy,
        stroke: 'rgba(108,99,255,0.5)', 'stroke-width': tsw,
        'stroke-dasharray': `${3/z} ${2/z}`, 'pointer-events': 'none',
      });
      const l2 = mk('line', {
        x1: s.x2, y1: s.y2, x2: cpx, y2: cpy,
        stroke: 'rgba(108,99,255,0.5)', 'stroke-width': tsw,
        'stroke-dasharray': `${3/z} ${2/z}`, 'pointer-events': 'none',
      });
      const cp = mk('circle', {
        cx: cpx, cy: cpy, r: cpr,
        fill: '#6c63ff', stroke: '#fff', 'stroke-width': sw,
        cursor: 'move',
      });
      cp.dataset.handle = 'cp';
      layer.appendChild(l1); layer.appendChild(l2); layer.appendChild(cp);
      this._handleEls.push(l1, l2, cp);
    }

    // ── Elbow: draggable bend-column handle ───────────────────────────────
    if (s.lineMode === 'elbow') {
      const mx = s.cpx ?? (s.x + s.x2) / 2;
      const my = (s.y + s.y2) / 2;   // midpoint of the vertical segment

      // Dashed vertical guide aligned with the bend column
      const vline = mk('line', {
        x1: mx, y1: s.y, x2: mx, y2: s.y2,
        stroke: 'rgba(108,99,255,0.35)', 'stroke-width': tsw,
        'stroke-dasharray': `${3/z} ${2/z}`, 'pointer-events': 'none',
      });

      // Diamond handle at the mid-point of the vertical segment
      const sz  = hs * 0.9;
      const pts = `${mx},${my - sz} ${mx + sz},${my} ${mx},${my + sz} ${mx - sz},${my}`;
      const elbow = mk('polygon', {
        points: pts,
        fill: '#6c63ff', stroke: '#fff', 'stroke-width': sw,
        cursor: 'ew-resize',
      });
      elbow.dataset.handle = 'elbow';

      layer.appendChild(vline);
      layer.appendChild(elbow);
      this._handleEls.push(vline, elbow);
    }

    // ── Anchor squares (endpoints) ─────────────────────────────────────────
    const a1 = mk('rect', {
      x: s.x - hs / 2, y: s.y - hs / 2, width: hs, height: hs,
      fill: '#fff', stroke: '#6c63ff', 'stroke-width': sw, cursor: 'move',
    });
    a1.dataset.handle = 'p1';

    const a2 = mk('rect', {
      x: s.x2 - hs / 2, y: s.y2 - hs / 2, width: hs, height: hs,
      fill: '#fff', stroke: '#6c63ff', 'stroke-width': sw, cursor: 'move',
    });
    a2.dataset.handle = 'p2';

    layer.appendChild(a1); layer.appendChild(a2);
    this._handleEls.push(a1, a2);
  }

  // ─── Pointer events ────────────────────────────────────────────────────────

  onPointerDown(wx, wy, e) {
    if (e.button !== 0) return;

    const el     = e.target;
    const handle = el.dataset?.handle;

    if (!handle) {
      // Click outside all handles → exit edit mode
      this.app.setActiveTool('select');
      return;
    }

    // Lazily materialise cpx/cpy on first interaction with a control-point handle.
    // This mirrors the auto-computed position used by render() and _rebuild().
    if (handle === 'cp' && this._shape.cpx === null) {
      const { cpx, cpy } = this._effectiveCp(this._shape);
      this._shape.cpx = cpx;
      this._shape.cpy = cpy;
    }
    if (handle === 'elbow' && this._shape.cpx === null) {
      this._shape.cpx = (this._shape.x + this._shape.x2) / 2;
    }

    this._snapshot = this._shape.snapshotState();
    this._dragging = {
      handle,
      startWx: wx, startWy: wy,
      snap: { ...this._snapshot },
    };

    e.stopPropagation();
    this.app.canvas.svg.setPointerCapture?.(e.pointerId);
    this._rebuild();
  }

  onPointerMove(wx, wy, e) {
    if (!this._dragging) return;
    const { handle, startWx, startWy, snap } = this._dragging;
    const canvas = this.app.canvas;

    const dx = wx - startWx;
    const dy = wy - startWy;

    if (handle === 'p1') {
      this._shape.x = canvas.snap(snap.x + dx);
      this._shape.y = canvas.snap(snap.y + dy);
    } else if (handle === 'p2') {
      this._shape.x2 = canvas.snap(snap.x2 + dx);
      this._shape.y2 = canvas.snap(snap.y2 + dy);
    } else if (handle === 'cp') {
      this._shape.cpx = canvas.snap(snap.cpx + dx);
      this._shape.cpy = canvas.snap(snap.cpy + dy);
    } else if (handle === 'elbow') {
      // Horizontal only — cpx stores the x-position of the bend column
      this._shape.cpx = canvas.snap(snap.cpx + dx);
    }

    this._shape.render();
    this._rebuild();
  }

  onPointerUp(wx, wy, e) {
    if (!this._dragging || !this._snapshot) { this._dragging = null; return; }

    const before = this._snapshot;
    const after  = this._shape.snapshotState();
    const shape  = this._shape;

    this.app.commands.execute({
      label: 'Edit line points',
      execute: () => { shape.applyState(after);  shape.render(); },
      undo:    () => { shape.applyState(before); shape.render(); },
    });

    this._dragging = null;
    this._snapshot = null;
  }
}
