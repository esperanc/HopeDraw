import { Shape } from './Shape.js';

/**
 * Freeform vector path shape.
 *
 * Each node: { x, y, cInX, cInY, cOutX, cOutY, smooth }
 *   x, y        — anchor world position
 *   cInX/cInY   — incoming Bézier handle (absolute coords; null = sharp)
 *   cOutX/cOutY — outgoing Bézier handle (absolute coords; null = sharp)
 *   smooth      — when true, handles are kept co-linear through the anchor
 *
 * Segment type from node[i] → node[i+1]:
 *   Both cOut[i] + cIn[i+1] exist → Cubic  (C)
 *   Only cOut[i] exists            → Quadratic (Q)
 *   Only cIn[i+1] exists           → Quadratic (Q)
 *   Neither                        → Line (L)
 */
export class PathShape extends Shape {
  constructor(data = {}) {
    super({ type: 'path', ...data });
    this.nodes  = (data.nodes ?? []).map(n => ({ ...n }));
    this.closed = data.closed ?? false;
    this._nodeRotation = data.rotation ?? 0;

    if (data.cachedBBox) {
      this._cachedBBox = { ...data.cachedBBox };
      this._syncFromCache();
    } else {
      this.recomputeBBox();
    }
  }

  _syncFromCache() {
    const bb = this._cachedBBox;
    if (bb) {
      this.x = bb.x;
      this.y = bb.y;
      this.width = bb.w;
      this.height = bb.h;
    }
  }

  get rotation() {
    return this._nodeRotation;
  }

  set rotation(val) {
    if (!this.nodes) {
      this._nodeRotation = val;
      return;
    }
    const current = this.rotation;
    const delta = val - current;
    if (Math.abs(delta) < 0.001) return;
    const bb = this.getBBox();
    this.rotate(delta, bb.x + bb.w / 2, bb.y + bb.h / 2);
  }

  // ─── SVG path building ────────────────────────────────────────────────────

  _buildD() {
    const n = this.nodes;
    if (!n.length) return 'M 0 0';
    let d = `M ${n[0].x} ${n[0].y}`;
    for (let i = 0; i < n.length - 1; i++) d += this._segD(n[i], n[i + 1]);
    if (this.closed && n.length > 1) {
      d += this._segD(n[n.length - 1], n[0]);
      d += ' Z';
    }
    return d;
  }

  _segD(a, b) {
    const aOut = a.cOutX != null;
    const bIn  = b.cInX  != null;
    if (aOut && bIn)
      return ` C ${a.cOutX} ${a.cOutY} ${b.cInX} ${b.cInY} ${b.x} ${b.y}`;
    if (aOut)
      return ` Q ${a.cOutX} ${a.cOutY} ${b.x} ${b.y}`;
    if (bIn)
      return ` Q ${b.cInX} ${b.cInY} ${b.x} ${b.y}`;
    return ` L ${b.x} ${b.y}`;
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  createElements(g) {
    this._pathEl = this.makeSVGEl('path');
    g.appendChild(this._pathEl);
  }

  render() {
    if (!this.el) return;
    this.el.removeAttribute('transform');
    this.el.style.opacity = this.opacity;
    this._pathEl.setAttribute('d', this._buildD());
    this._pathEl.setAttribute('fill',   this.fill || 'none');
    this._pathEl.setAttribute('stroke', this.stroke);
    this._pathEl.setAttribute('stroke-width', this.strokeWidth);
    this._pathEl.setAttribute('stroke-dasharray', this._strokeDashArray());
    this._pathEl.setAttribute('stroke-linecap',  'round');
    this._pathEl.setAttribute('stroke-linejoin', 'round');
  }

  getBBox() {
    return this._cachedBBox ?? { x: 0, y: 0, w: 1, h: 1 };
  }

  getRotatedCorners() {
    const bb = this._cachedBBox;
    if (!bb) return [];
    const cx = bb.x + bb.w / 2;
    const cy = bb.y + bb.h / 2;
    const r  = (this.rotation ?? 0) * Math.PI / 180;
    const cos = Math.cos(r), sin = Math.sin(r);
    const rot = (px, py) => {
      const dx = px - cx, dy = py - cy;
      return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos];
    };
    return [
      rot(bb.x,        bb.y),
      rot(bb.x + bb.w, bb.y),
      rot(bb.x + bb.w, bb.y + bb.h),
      rot(bb.x,        bb.y + bb.h),
    ];
  }

  recomputeBBox() {
    if (!this.nodes.length) {
      this._cachedBBox = { x: 0, y: 0, w: 1, h: 1 };
      return;
    }

    // Optionally unrotate into the local frame so node edits on a rotated shape
    // recompute the true unrotated bounds (same behaviour as before).
    let tf = (px, py) => [px, py];
    if (this._cachedBBox && this.rotation) {
      const cx = this._cachedBBox.x + this._cachedBBox.w / 2;
      const cy = this._cachedBBox.y + this._cachedBBox.h / 2;
      const r = -this.rotation * Math.PI / 180;
      const cos = Math.cos(r), sin = Math.sin(r);
      tf = (px, py) => {
        const dx = px - cx, dy = py - cy;
        return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos];
      };
    }

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const spanX = xs => { for (const x of xs) { if (x < minX) minX = x; if (x > maxX) maxX = x; } };
    const spanY = ys => { for (const y of ys) { if (y < minY) minY = y; if (y > maxY) maxY = y; } };

    const n = this.nodes;
    // Anchors are always inside the curve; include them (covers single-node paths).
    n.forEach(node => { const [x, y] = tf(node.x, node.y); spanX([x]); spanY([y]); });

    // Walk each segment and add the *curve's* exact extrema — the tight bounds
    // of the drawn Bézier/line, not the control-point hull.
    const segCount = this.closed ? n.length : n.length - 1;
    for (let i = 0; i < segCount; i++) {
      const a = n[i], b = n[(i + 1) % n.length];
      const [ax, ay] = tf(a.x, a.y);
      const [bx, by] = tf(b.x, b.y);
      const aOut = a.cOutX != null;
      const bIn  = b.cInX  != null;

      if (aOut && bIn) {
        const [c1x, c1y] = tf(a.cOutX, a.cOutY);
        const [c2x, c2y] = tf(b.cInX,  b.cInY);
        spanX(this._cubicExtrema(ax, c1x, c2x, bx));
        spanY(this._cubicExtrema(ay, c1y, c2y, by));
      } else if (aOut) {
        const [c1x, c1y] = tf(a.cOutX, a.cOutY);
        spanX(this._quadExtrema(ax, c1x, bx));
        spanY(this._quadExtrema(ay, c1y, by));
      } else if (bIn) {
        const [c1x, c1y] = tf(b.cInX, b.cInY);
        spanX(this._quadExtrema(ax, c1x, bx));
        spanY(this._quadExtrema(ay, c1y, by));
      }
      // else: straight line — endpoints already covered by the anchor pass.
    }

    this._cachedBBox = { x: minX, y: minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) };
    this._syncFromCache();
  }

  /**
   * Values of a cubic Bézier component (one axis) at its endpoints and at any
   * interior derivative root in (0,1) — i.e. the exact min/max candidates for
   * that segment along that axis. No sampling.
   */
  _cubicExtrema(p0, p1, p2, p3) {
    const vals = [p0, p3];
    // B'(t)/3 = qa·t² + qb·t + qc
    const qa = -p0 + 3 * p1 - 3 * p2 + p3;
    const qb = 2 * (p0 - 2 * p1 + p2);
    const qc = -p0 + p1;
    const EPS = 1e-9;
    const roots = [];
    if (Math.abs(qa) < EPS) {
      if (Math.abs(qb) > EPS) roots.push(-qc / qb);
    } else {
      const disc = qb * qb - 4 * qa * qc;
      if (disc >= 0) {
        const sq = Math.sqrt(disc);
        roots.push((-qb + sq) / (2 * qa), (-qb - sq) / (2 * qa));
      }
    }
    for (const t of roots) {
      if (t > 0 && t < 1) {
        const mt = 1 - t;
        vals.push(mt*mt*mt*p0 + 3*mt*mt*t*p1 + 3*mt*t*t*p2 + t*t*t*p3);
      }
    }
    return vals;
  }

  /** Same as _cubicExtrema for a quadratic Bézier component. */
  _quadExtrema(p0, p1, p2) {
    const vals = [p0, p2];
    const denom = p0 - 2 * p1 + p2;
    if (Math.abs(denom) > 1e-9) {
      const t = (p0 - p1) / denom;
      if (t > 0 && t < 1) {
        const mt = 1 - t;
        vals.push(mt*mt*p0 + 2*mt*t*p1 + t*t*p2);
      }
    }
    return vals;
  }

  hitTest(wx, wy) {
    if (!this._pathEl) return false;
    try {
      const svg = this._pathEl.ownerSVGElement;
      if (svg?.createSVGPoint) {
        const pt = svg.createSVGPoint();
        pt.x = wx; pt.y = wy;
        if (this._pathEl.isPointInStroke?.(pt)) return true;
        if (this.fill !== 'none' && this.fill !== 'transparent' && this._pathEl.isPointInFill?.(pt)) return true;
      }
    } catch (_) {}
    // Fallback: proximity to any node
    return this.nodes.some(n => Math.hypot(n.x - wx, n.y - wy) < 8);
  }

  translate(dx, dy) {
    this.nodes = this.nodes.map(n => ({
      ...n,
      x: n.x + dx, y: n.y + dy,
      cInX:  n.cInX  != null ? n.cInX  + dx : null,
      cInY:  n.cInY  != null ? n.cInY  + dy : null,
      cOutX: n.cOutX != null ? n.cOutX + dx : null,
      cOutY: n.cOutY != null ? n.cOutY + dy : null,
    }));
    if (this._cachedBBox) {
      this._cachedBBox.x += dx;
      this._cachedBBox.y += dy;
      this._syncFromCache();
    }
    this.render();
  }

  rotate(angle, pivotX, pivotY) {
    const r   = angle * Math.PI / 180;
    const cos = Math.cos(r), sin = Math.sin(r);
    const rotatePt = (px, py) => {
      const dx = px - pivotX, dy = py - pivotY;
      return [pivotX + dx * cos - dy * sin, pivotY + dx * sin + dy * cos];
    };

    this.nodes = this.nodes.map(n => {
      const newNode = { ...n };
      [newNode.x, newNode.y] = rotatePt(n.x, n.y);
      if (n.cInX != null && n.cInY != null) {
        [newNode.cInX, newNode.cInY] = rotatePt(n.cInX, n.cInY);
      }
      if (n.cOutX != null && n.cOutY != null) {
        [newNode.cOutX, newNode.cOutY] = rotatePt(n.cOutX, n.cOutY);
      }
      return newNode;
    });
    
    // Rotate the cached bbox CENTRE around the pivot (keep w/h unchanged).
    if (this._cachedBBox) {
      const ox  = this._cachedBBox.x + this._cachedBBox.w / 2;
      const oy  = this._cachedBBox.y + this._cachedBBox.h / 2;
      const [newCx, newCy] = rotatePt(ox, oy);
      this._cachedBBox.x = newCx - this._cachedBBox.w / 2;
      this._cachedBBox.y = newCy - this._cachedBBox.h / 2;
      this._syncFromCache();
    }

    this._nodeRotation = (this._nodeRotation + angle + 360) % 360;
    this.render();
  }

  resize(anchorX, anchorY, scaleX, scaleY, localRotationOverride) {
    const bb = this.getBBox();
    const θ = (localRotationOverride ?? this.rotation ?? 0) * Math.PI / 180;
    const cos = Math.cos(θ), sin = Math.sin(θ);

    const oldCx = bb.x + bb.w / 2, oldCy = bb.y + bb.h / 2;
    const newCx = anchorX + (oldCx - anchorX) * scaleX;
    const newCy = anchorY + (oldCy - anchorY) * scaleY;

    const unrot = (px, py) => {
      const dx = px - oldCx, dy = py - oldCy;
      return [oldCx + dx * cos + dy * sin, oldCy - dx * sin + dy * cos];
    };
    const rerot = (px, py) => {
      const dx = px - newCx, dy = py - newCy;
      return [newCx + dx * cos - dy * sin, newCy + dx * sin + dy * cos];
    };
    const scl = (px, py) => [
      anchorX + (px - anchorX) * scaleX,
      anchorY + (py - anchorY) * scaleY,
    ];

    this.nodes = this.nodes.map(n => {
      const newNode = { ...n };
      [newNode.x, newNode.y] = rerot(...scl(...unrot(n.x, n.y)));
      if (n.cInX != null && n.cInY != null) {
        [newNode.cInX, newNode.cInY] = rerot(...scl(...unrot(n.cInX, n.cInY)));
      }
      if (n.cOutX != null && n.cOutY != null) {
        [newNode.cOutX, newNode.cOutY] = rerot(...scl(...unrot(n.cOutX, n.cOutY)));
      }
      return newNode;
    });
    
    const finalW = Math.max(2, Math.abs(bb.w * scaleX));
    const finalH = Math.max(2, Math.abs(bb.h * scaleY));
    this._cachedBBox = {
      x: newCx - finalW / 2,
      y: newCy - finalH / 2,
      w: finalW,
      h: finalH,
    };
    this._syncFromCache();

    this.render();
  }

  snapshotState() {
    return { 
      nodes: this.nodes.map(n => ({ ...n })), 
      closed: this.closed, 
      rotation: this.rotation,
      cachedBBox: this._cachedBBox ? { ...this._cachedBBox } : null,
    };
  }

  applyState(s) {
    this.nodes  = s.nodes.map(n => ({ ...n }));
    this.closed = s.closed;
    this._nodeRotation = s.rotation ?? 0;
    if (s.cachedBBox) {
      this._cachedBBox = { ...s.cachedBBox };
      this._syncFromCache();
    } else {
      this.recomputeBBox();
    }
  }

  serialize() {
    return {
      ...super.serialize(),
      nodes:  this.nodes.map(n => ({ ...n })),
      closed: this.closed,
      rotation: this.rotation,
      cachedBBox: this._cachedBBox ? { ...this._cachedBBox } : null,
    };
  }

  static deserialize(data) { return new PathShape(data); }
}
