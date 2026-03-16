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

    const now = Date.now();
    const isDouble = (now - (this._lastClickTime || 0) < 300);
    this._lastClickTime = now;

    const el  = e.target;
    const pht = el.dataset?.pht;
    const ni  = parseInt(el.dataset?.ni, 10);

    // 1. Double click on an anchor -> Toggle smoothness
    if (isDouble && pht === 'anchor' && !isNaN(ni)) {
      this._toggleNodeSmoothness(ni);
      e.stopPropagation();
      return;
    }

    if (!pht || isNaN(ni)) {
      // 2. Double click on the stroke -> Insert node
      if (isDouble && this._insertNodeAt(wx, wy)) {
        e.stopPropagation();
        return;
      }

      if (pht === 'tangent') return;

      // 3. Single click on the stroke -> Do nothing, wait for potential double click or drag
      if (this._getHitSegment(wx, wy)) return;

      // 4. Click outside all handles and stroke → exit edit mode
      this.app.setActiveTool('select');
      return;
    }
    if (pht === 'tangent') return;

    // Alt+Click on anchor -> delete node immediately
    if (e.altKey && pht === 'anchor') {
      this._deleteNode(ni);
      e.stopPropagation();
      return;
    }

    // We do NOT snap wx/wy here so that we have high-precision starting points 
    // for calculating the drag delta in onPointerMove.
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
    const { nodeIdx, type, startWx, startWy, origNode } = this._dragging;
    const canvas = this.app.canvas;

    const dx   = wx - startWx;
    const dy   = wy - startWy;
    const node = this._shape.nodes[nodeIdx];

    if (type === 'anchor') {
      // Snap the anchor to the grid
      const snapX = canvas.snap(origNode.x + dx);
      const snapY = canvas.snap(origNode.y + dy);
      const adx = snapX - origNode.x;
      const ady = snapY - origNode.y;

      node.x = snapX;
      node.y = snapY;
      // Move attached control points by the same delta to preserve relative geometry
      if (origNode.cInX  != null) { node.cInX  = origNode.cInX  + adx; node.cInY  = origNode.cInY  + ady; }
      if (origNode.cOutX != null) { node.cOutX = origNode.cOutX + adx; node.cOutY = origNode.cOutY + ady; }

    } else if (type === 'cpOut') {
      node.cOutX = canvas.snap(origNode.cOutX + dx);
      node.cOutY = canvas.snap(origNode.cOutY + dy);
      // Mirror cIn to keep smooth (distance is preserved, but angle might change slightly due to snapping)
      if (node.smooth && origNode.cInX != null) {
        const lenIn  = Math.hypot(origNode.cInX - origNode.x, origNode.cInY - origNode.y);
        const ddx = node.cOutX - node.x, ddy = node.cOutY - node.y;
        const lenOut = Math.hypot(ddx, ddy) || 1;
        node.cInX = node.x - ddx / lenOut * lenIn;
        node.cInY = node.y - ddy / lenOut * lenIn;
      }

    } else if (type === 'cpIn') {
      node.cInX = canvas.snap(origNode.cInX + dx);
      node.cInY = canvas.snap(origNode.cInY + dy);
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



  _toggleNodeSmoothness(idx) {
    const node = this._shape.nodes[idx];
    if (!node) return;

    const before = this._shape.nodes.map(n => ({ ...n }));
    const after  = this._shape.nodes.map(n => ({ ...n }));
    const target = after[idx];

    if (target.smooth) {
      // Smooth -> Sharp
      target.smooth = false;
      target.cInX = null; target.cInY = null;
      target.cOutX = null; target.cOutY = null;
    } else {
      // Sharp -> Smooth (synthesize generic handles horizontally)
      target.smooth = true;
      const offset = 20; // 20px default bezier handle span
      target.cInX = target.x - offset; target.cInY = target.y;
      target.cOutX = target.x + offset; target.cOutY = target.y;
    }

    const shape = this._shape;
    this.app.commands.execute({
      label: 'Toggle node smoothness',
      execute: () => { shape.nodes = after.map(n => ({ ...n })); shape.recomputeBBox(); shape.render(); },
      undo:    () => { shape.nodes = before.map(n => ({ ...n })); shape.recomputeBBox(); shape.render(); },
    });
    this._rebuild();
  }

  _getHitSegment(wx, wy) {
    if (this._shape.nodes.length < 2) return null;

    // 1. Find the nearest segment boundary across all nodes
    let bestIdx = -1;
    let bestDist = Infinity;
    let bestT = 0; // The continuous t-value (0 to 1) along the curve where the hit happened

    const nodes = this._shape.nodes;
    const len = this._shape.closed ? nodes.length : nodes.length - 1;

    for (let i = 0; i < len; i++) {
      const n1 = nodes[i];
      const n2 = nodes[(i + 1) % nodes.length];

      // A quick generic lookup by taking 20 samples along the mathematical segment
      for (let s = 0; s <= 20; s++) {
        const t = s / 20;
        const pt = this._evalSegment(n1, n2, t);
        const dist = Math.hypot(pt.x - wx, pt.y - wy);
        if (dist < bestDist) {
          bestDist = dist;
          bestIdx = i + 1; // Insert AT the next index
          bestT = t;
        }
      }
    }

    // If the click was nowhere near the stroke (> 20 screen pixels), ignore it.
    if (bestDist * this.app.canvas.zoom > 20) return null;
    return { idx: bestIdx, t: bestT };
  }

  _insertNodeAt(wx, wy) {
    const hit = this._getHitSegment(wx, wy);
    if (!hit) return false;

    const { idx: bestIdx, t: bestT } = hit;
    const nodes = this._shape.nodes;
    
    // 2. Perform the insertion
    const n1 = nodes[bestIdx - 1];
    const n2 = nodes[bestIdx % nodes.length];
    
    // Evaluate the exact geometry at t to preserve curve position
    const pt = this._evalSegment(n1, n2, bestT);
    
    const newNode = {
      x: pt.x, y: pt.y,
      cInX: null, cInY: null,
      cOutX: null, cOutY: null,
      smooth: false
    };

    // If it was a curve, we do De Casteljau's algorithm to split the bezier
    if (n1.cOutX != null || n2.cInX != null) {
      const p0x = n1.x, p0y = n1.y;
      const p1x = n1.cOutX ?? n1.x, p1y = n1.cOutY ?? n1.y;
      const p2x = n2.cInX ?? n2.x, p2y = n2.cInY ?? n2.y;
      const p3x = n2.x, p3y = n2.y;

      // De Casteljau subdivision at t
      const lerp = (a, b, t) => a + (b - a) * t;
      const q0x = lerp(p0x, p1x, bestT), q0y = lerp(p0y, p1y, bestT);
      const q1x = lerp(p1x, p2x, bestT), q1y = lerp(p1y, p2y, bestT);
      const q2x = lerp(p2x, p3x, bestT), q2y = lerp(p2y, p3y, bestT);
      const r0x = lerp(q0x, q1x, bestT), r0y = lerp(q0y, q1y, bestT);
      const r1x = lerp(q1x, q2x, bestT), r1y = lerp(q1y, q2y, bestT);
      // The point pt is lerp(r0, r1, t)

      n1.cOutX = q0x; n1.cOutY = q0y;
      newNode.cInX = r0x; newNode.cInY = r0y;
      newNode.cOutX = r1x; newNode.cOutY = r1y;
      n2.cInX = q2x; n2.cInY = q2y;
      newNode.smooth = true;
    }

    const before = this._shape.nodes.map(n => ({ ...n }));
    const after  = this._shape.nodes.map(n => ({ ...n }));
    after.splice(bestIdx, 0, newNode);

    const shape = this._shape;
    this.app.commands.execute({
      label: 'Insert path node',
      execute: () => { shape.nodes = after.map(n => ({ ...n })); shape.recomputeBBox(); shape.render(); },
      undo:    () => { shape.nodes = before.map(n => ({ ...n })); shape.recomputeBBox(); shape.render(); },
    });
    
    this._selectedIdx = bestIdx;
    this._rebuild();
    return true;
  }

  // Evaluates a cubic bezier (or line) at parameter t [0,1]
  _evalSegment(n1, n2, t) {
    if (n1.cOutX == null && n2.cInX == null) {
      return {
        x: n1.x + (n2.x - n1.x) * t,
        y: n1.y + (n2.y - n1.y) * t
      };
    }
    const p0x = n1.x, p0y = n1.y;
    const p1x = n1.cOutX ?? n1.x, p1y = n1.cOutY ?? n1.y;
    const p2x = n2.cInX ?? n2.x, p2y = n2.cInY ?? n2.y;
    const p3x = n2.x, p3y = n2.y;
    const mt = 1 - t;
    const mt2 = mt * mt;
    const mt3 = mt2 * mt;
    const t2 = t * t;
    const t3 = t2 * t;
    return {
      x: mt3 * p0x + 3 * mt2 * t * p1x + 3 * mt * t2 * p2x + t3 * p3x,
      y: mt3 * p0y + 3 * mt2 * t * p1y + 3 * mt * t2 * p2y + t3 * p3y
    };
  }
}
