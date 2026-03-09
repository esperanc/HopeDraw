/**
 * PathEditTool — node editing mode for existing PathShape objects.
 *
 * Activated by SelectTool's double-click on a path shape.
 * Renders editable handles (anchors + Bézier control points) into the handles
 * layer and lets the user drag them individually.
 *
 * Square handle  → anchor point (moves the whole node + its handles)
 * Circle handle  → Bézier control point (cIn or cOut)
 * Escape         → exit back to select mode
 * Delete/Backspace → delete the selected node (if ≥ 3 remain)
 */
export class PathEditTool {
  constructor(app) {
    this.app            = app;
    this._shape         = null;
    this._handleEls     = [];
    this._dragging      = null;   // { nodeIdx, type, startWx, startWy, origNode }
    this._snapshot      = null;   // full node array before current drag
    this._selectedIdx   = null;   // which node is "selected" (for keyboard delete)
    this._onKey         = this._onKey.bind(this);
  }

  /** Called externally (from SelectTool.onDblClick) to enter node-edit mode */
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
    // Return normal select-tool selection on the path we were editing
    if (this._shape) {
      this.app.selection.select(this._shape.id);
    }
    this._shape       = null;
    this._dragging    = null;
    this._snapshot    = null;
    this._selectedIdx = null;
  }

  // ─── Keyboard ─────────────────────────────────────────────────────────────

  _onKey(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      this.app.setActiveTool('select');
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && this._selectedIdx != null) {
      if (document.activeElement?.tagName === 'INPUT') return;
      e.preventDefault();
      this._deleteNode(this._selectedIdx);
    }
  }

  // ─── Handle rendering ─────────────────────────────────────────────────────

  _clearHandles() {
    this._handleEls.forEach(el => el.remove());
    this._handleEls = [];
  }

  _rebuild() {
    this._clearHandles();
    if (!this._shape) return;

    const ns    = 'http://www.w3.org/2000/svg';
    const z     = this.app.canvas.zoom;
    const hs    = 7 / z;   // anchor half-size
    const cpr   = 4 / z;   // control-point radius
    const sw    = 1.5 / z;
    const tsw   = 1 / z;
    const nodes = this._shape.nodes;
    const layer = this.app.canvas.handlesLayer;

    const mk = (tag, attrs) => {
      const el = document.createElementNS(ns, tag);
      for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
      return el;
    };

    nodes.forEach((node, i) => {
      // ── Tangent lines ────────────────────────────────────────────────────
      ['In', 'Out'].forEach(dir => {
        const cx = node[`c${dir}X`], cy = node[`c${dir}Y`];
        if (cx == null) return;
        const line = mk('line', {
          x1: node.x, y1: node.y, x2: cx, y2: cy,
          stroke: 'rgba(108,99,255,0.5)',
          'stroke-width': tsw,
          'stroke-dasharray': `${3/z} ${2/z}`,
          'pointer-events': 'none',
        });
        layer.appendChild(line);
        this._handleEls.push(line);
      });

      // ── Bézier control points ────────────────────────────────────────────
      ['In', 'Out'].forEach(dir => {
        const cx = node[`c${dir}X`], cy = node[`c${dir}Y`];
        if (cx == null) return;
        const cp = mk('circle', {
          cx, cy, r: cpr,
          fill: '#6c63ff', stroke: '#fff', 'stroke-width': sw,
          cursor: 'move',
        });
        cp.dataset.pht = `cp${dir}`;   // pathHandleType
        cp.dataset.ni  = i;
        layer.appendChild(cp);
        this._handleEls.push(cp);
      });

      // ── Anchor square ────────────────────────────────────────────────────
      const isSelected = i === this._selectedIdx;
      const anchor = mk('rect', {
        x: node.x - hs / 2, y: node.y - hs / 2, width: hs, height: hs,
        fill:          isSelected ? '#6c63ff' : '#fff',
        stroke:        '#6c63ff',
        'stroke-width': sw,
        cursor:        'move',
      });
      anchor.dataset.pht = 'anchor';
      anchor.dataset.ni  = i;
      layer.appendChild(anchor);
      this._handleEls.push(anchor);
    });
  }

  // ─── Pointer events ────────────────────────────────────────────────────────

  onPointerDown(wx, wy, e) {
    if (e.button !== 0) return;

    const el  = e.target;
    const pht = el.dataset?.pht;
    const ni  = parseInt(el.dataset?.ni, 10);

    if (!pht || isNaN(ni)) {
      // Click outside all handles → exit edit mode
      this.app.setActiveTool('select');
      return;
    }
    if (pht === 'tangent') return;

    wx = this.app.canvas.snap(wx);
    wy = this.app.canvas.snap(wy);

    this._selectedIdx = ni;
    this._snapshot    = this._shape.nodes.map(n => ({ ...n }));
    this._dragging    = {
      nodeIdx: ni, type: pht,
      startWx: wx, startWy: wy,
      origNode: { ...this._shape.nodes[ni] },
    };

    e.stopPropagation();
    this.app.canvas.svg.setPointerCapture?.(e.pointerId);
    this._rebuild();
  }

  onPointerMove(wx, wy, e) {
    if (!this._dragging) return;
    wx = this.app.canvas.snap(wx);
    wy = this.app.canvas.snap(wy);

    const { nodeIdx, type, startWx, startWy, origNode } = this._dragging;
    const dx   = wx - startWx;
    const dy   = wy - startWy;
    const node = this._shape.nodes[nodeIdx];

    if (type === 'anchor') {
      // Move anchor + all attached control points by the same delta
      node.x = origNode.x + dx;
      node.y = origNode.y + dy;
      if (origNode.cInX  != null) { node.cInX  = origNode.cInX  + dx; node.cInY  = origNode.cInY  + dy; }
      if (origNode.cOutX != null) { node.cOutX = origNode.cOutX + dx; node.cOutY = origNode.cOutY + dy; }

    } else if (type === 'cpOut') {
      node.cOutX = origNode.cOutX + dx;
      node.cOutY = origNode.cOutY + dy;
      // Mirror cIn to keep smooth
      if (node.smooth && origNode.cInX != null) {
        const lenIn  = Math.hypot(origNode.cInX - origNode.x, origNode.cInY - origNode.y);
        const ddx = node.cOutX - node.x, ddy = node.cOutY - node.y;
        const lenOut = Math.hypot(ddx, ddy) || 1;
        node.cInX = node.x - ddx / lenOut * lenIn;
        node.cInY = node.y - ddy / lenOut * lenIn;
      }

    } else if (type === 'cpIn') {
      node.cInX = origNode.cInX + dx;
      node.cInY = origNode.cInY + dy;
      // Mirror cOut to keep smooth
      if (node.smooth && origNode.cOutX != null) {
        const lenOut = Math.hypot(origNode.cOutX - origNode.x, origNode.cOutY - origNode.y);
        const ddx = node.cInX - node.x, ddy = node.cInY - node.y;
        const lenIn = Math.hypot(ddx, ddy) || 1;
        node.cOutX = node.x - ddx / lenIn * lenOut;
        node.cOutY = node.y - ddy / lenIn * lenOut;
      }
    }

    this._shape.render();
    this._rebuild();
  }

  onPointerUp(wx, wy, e) {
    if (!this._dragging || !this._snapshot) { this._dragging = null; return; }

    const before = this._snapshot;
    const after  = this._shape.nodes.map(n => ({ ...n }));
    const shape  = this._shape;

    this.app.commands.execute({
      label: 'Edit path nodes',
      execute: () => { shape.nodes = after.map(n => ({ ...n })); shape.recomputeBBox(); shape.render(); },
      undo:    () => { shape.nodes = before.map(n => ({ ...n })); shape.recomputeBBox(); shape.render(); },
    });

    this._dragging = null;
    this._snapshot = null;
  }

  // ─── Node deletion ────────────────────────────────────────────────────────

  _deleteNode(idx) {
    if (!this._shape || this._shape.nodes.length < 3) return;
    const before = this._shape.nodes.map(n => ({ ...n }));
    this._shape.nodes.splice(idx, 1);
    this._shape.render();
    const after = this._shape.nodes.map(n => ({ ...n }));
    const shape = this._shape;
    this.app.commands.execute({
      label: 'Delete path node',
      execute: () => { shape.nodes = after.map(n => ({ ...n })); shape.recomputeBBox(); shape.render(); },
      undo:    () => { shape.nodes = before.map(n => ({ ...n })); shape.recomputeBBox(); shape.render(); },
    });
    this._selectedIdx = null;
    this._rebuild();
  }
}
