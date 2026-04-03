import { Shape } from './Shape.js';

/**
 * Line / Arrow shape.
 * Stored as (x,y) → (x2,y2) with optional control point for curves.
 * Arrow head styles: 'none' | 'open' | 'filled' | 'circle' | 'square' | 'double'
 * Line modes: 'straight' | 'curve' | 'elbow'
 *
 * IMPORTANT: LineShape does NOT use an SVG `rotate()` transform for rotation.
 * Instead, rotation is applied geometrically to the endpoints.
 * The `rotation` property inherited from Shape is left as a plain number (0) and
 * is NOT used for rendering; it exists only for compatibility with serialization /
 * PropertiesPanel. To actually rotate a line, use rotate(angle, px, py) or the
 * `lineAngle` setter which delegates to rotate().
 */
export class LineShape extends Shape {
  constructor(data = {}) {
    // We must NOT pass `rotation` to super(), because Shape's constructor does:
    //   this.rotation = data.rotation ?? 0
    // If LineShape had a `set rotation` accessor on its prototype, that plain
    // assignment in the base constructor would trigger the setter BEFORE x2/y2 are
    // initialized, producing NaN.  So we strip rotation here and handle it ourselves.
    const { rotation: _savedRotation, ...rest } = data;
    super({ type: 'line', fill: 'none', ...rest });
    // At this point Shape.rotation is a plain own-property set to 0 (no setter was called).

    this.x2         = data.x2         ?? this.x + 100;
    this.y2         = data.y2         ?? this.y;
    this.cpx        = data.cpx        ?? null;
    this.cpy        = data.cpy        ?? null;
    this.arrowStart = data.arrowStart ?? 'none';
    this.arrowEnd   = data.arrowEnd   ?? 'filled';
    this.lineMode   = data.lineMode   ?? 'straight'; // 'straight'|'curve'|'elbow'
    this.arrowSize  = data.arrowSize  ?? 12;

    // If a saved geometric rotation exists, apply it now that x2/y2 are ready.
    if (_savedRotation) {
      const cx = (this.x + this.x2) / 2;
      const cy = (this.y + this.y2) / 2;
      this.rotate(_savedRotation, cx, cy);
    }
  }

  // ─── Geometry helpers ─────────────────────────────────────────────────────

  /** Rotate both endpoints around a pivot by `angle` degrees. */
  rotate(angle, pivotX, pivotY) {
    const r = angle * Math.PI / 180;
    const cos = Math.cos(r), sin = Math.sin(r);
    const rotatePt = (px, py) => {
      const dx = px - pivotX, dy = py - pivotY;
      return [pivotX + dx * cos - dy * sin, pivotY + dx * sin + dy * cos];
    };

    if (this.lineMode === 'elbow') {
      if (this.cpx === null || this.cpy === null) {
        this.cpx = (this.x + this.x2) / 2;
        this.cpy = this.y;
      }
      [this.x,  this.y]  = rotatePt(this.x, this.y);
      [this.x2, this.y2] = rotatePt(this.x2, this.y2);
      [this.cpx, this.cpy] = rotatePt(this.cpx, this.cpy);

    } else if (this.lineMode === 'curve') {
      // Materialise cpx before rotating so the control point follows correctly.
      if (this.cpx === null) {
        const mx = (this.x + this.x2) / 2, my = (this.y + this.y2) / 2;
        const dl = Math.hypot(this.x2 - this.x, this.y2 - this.y) || 1;
        this.cpx = mx + (-(this.y2 - this.y) / dl) * dl * 0.25;
        this.cpy = my + ( (this.x2 - this.x) / dl) * dl * 0.25;
      }
      [this.x,  this.y]  = rotatePt(this.x, this.y);
      [this.x2, this.y2] = rotatePt(this.x2, this.y2);
      [this.cpx, this.cpy] = rotatePt(this.cpx, this.cpy);

    } else {
      [this.x,  this.y]  = rotatePt(this.x, this.y);
      [this.x2, this.y2] = rotatePt(this.x2, this.y2);
    }

    this.render();
  }



  /**
   * Read the current visual angle of the line (in degrees).
   * This computes from the endpoints rather than from a stored field,
   * because rotation is baked into the coordinates.
   */
  get lineAngle() {
    return Math.atan2(this.y2 - this.y, this.x2 - this.x) * 180 / Math.PI;
  }

  /**
   * Set the visual angle of the line (in degrees) by rotating the endpoints.
   * Used by PropertiesPanel when the user edits the Rotation field.
   */
  set lineAngle(val) {
    const delta = val - this.lineAngle;
    if (Math.abs(delta) < 0.001) return;
    const cx = (this.x + this.x2) / 2;
    const cy = (this.y + this.y2) / 2;
    this.rotate(delta, cx, cy);
  }

  // ─── Rendering ────────────────────────────────────────────────────────────

  createElements(g) {
    this._path = this.makeSVGEl('path');
    this._capS = this.makeSVGEl('g'); // start cap
    this._capE = this.makeSVGEl('g'); // end cap
    g.appendChild(this._path);
    g.appendChild(this._capS);
    g.appendChild(this._capE);
  }

  render() {
    if (!this.el) return;
    this.el.removeAttribute('transform');
    this.el.style.opacity = this.opacity;

    const { x: x1, y: y1, x2, y2, stroke, strokeWidth } = this;

    const sbS = this._arrowSetback(this.arrowStart);
    const sbE = this._arrowSetback(this.arrowEnd);

    // Tangent unit vectors at each endpoint — used for BOTH path setback and
    // arrowhead direction.  uxS/uyS points AWAY from the start; uxE/uyE points
    // INTO the end (i.e. in the direction the line is travelling at that end).
    let uxS, uyS, uxE, uyE;
    let d;

    if (this.lineMode === 'curve') {
      // Resolve control point — auto-initialise with a small perpendicular
      // offset so the curve is visible even before the user drags it.
      let cpx = this.cpx, cpy = this.cpy;
      if (cpx === null) {
        const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
        const dl = Math.hypot(x2 - x1, y2 - y1) || 1;
        // 25 % of line length, perpendicular to the line
        cpx = mx + (-(y2 - y1) / dl) * dl * 0.25;
        cpy = my + ( (x2 - x1) / dl) * dl * 0.25;
      }
      // Tangent at start = P0→P1 (toward control point)
      const d1x = cpx - x1, d1y = cpy - y1, l1 = Math.hypot(d1x, d1y) || 1;
      // Tangent at end   = P1→P2 (from control point toward endpoint)
      const d2x = x2 - cpx, d2y = y2 - cpy, l2 = Math.hypot(d2x, d2y) || 1;
      uxS = d1x / l1; uyS = d1y / l1;
      uxE = d2x / l2; uyE = d2y / l2;
      const px1 = x1 + uxS * sbS, py1 = y1 + uyS * sbS;
      const px2 = x2 - uxE * sbE, py2 = y2 - uyE * sbE;
      d = `M ${px1} ${py1} Q ${cpx} ${cpy} ${px2} ${py2}`;

    } else if (this.lineMode === 'elbow') {
      let j1x = this.cpx, j1y = this.cpy;
      if (j1x === null || j1y === null) {
        j1x = (x1 + x2) / 2;
        j1y = y1;
        this.cpx = j1x;
        this.cpy = j1y;
      }
      const v1x = j1x - x1, v1y = j1y - y1;
      const len1Sq = v1x * v1x + v1y * v1y;
      const len1 = Math.sqrt(len1Sq);

      let j2x = x2, j2y = y2;
      let v3x = 0, v3y = 0;
      let len3 = 0, len2 = 0;

      if (len1Sq > 1e-6) {
        const dp = (x2 - j1x) * v1x + (y2 - j1y) * v1y;
        const k = dp / len1Sq;
        j2x = x2 - k * v1x;
        j2y = y2 - k * v1y;
        
        const v2x = j2x - j1x, v2y = j2y - j1y;
        len2 = Math.hypot(v2x, v2y);

        v3x = x2 - j2x;
        v3y = y2 - j2y;
        len3 = Math.hypot(v3x, v3y);
      } else {
        const dxL = x2 - x1, dyL = y2 - y1;
        const len = Math.hypot(dxL, dyL) || 1;
        uxS = dxL / len; uyS = dyL / len;
        uxE = uxS; uyE = uyS;
        const px1 = x1 + uxS * sbS, py1 = y1 + uyS * sbS;
        const px2 = x2 - uxE * sbE, py2 = y2 - uyE * sbE;
        d = `M ${px1} ${py1} L ${px2} ${py2}`;
      }

      if (len1Sq > 1e-6) {
        uxS = v1x / len1;
        uyS = v1y / len1;
        if (len3 > 1e-4) {
          uxE = v3x / len3;
          uyE = v3y / len3;
        } else if (len2 > 1e-4) {
          uxE = (j2x - j1x) / len2;
          uyE = (j2y - j1y) / len2;
        } else {
          uxE = uxS; 
          uyE = uyS;
        }

        const px1 = x1 + uxS * sbS, py1 = y1 + uyS * sbS;
        const px2 = x2 - uxE * sbE, py2 = y2 - uyE * sbE;
        d = `M ${px1} ${py1} L ${j1x} ${j1y} L ${j2x} ${j2y} L ${px2} ${py2}`;
      }

    } else {
      // Straight line
      const dxL = x2 - x1, dyL = y2 - y1;
      const len = Math.hypot(dxL, dyL) || 1;
      uxS = dxL / len; uyS = dyL / len;
      uxE = uxS; uyE = uyS;
      const px1 = x1 + uxS * sbS, py1 = y1 + uyS * sbS;
      const px2 = x2 - uxE * sbE, py2 = y2 - uyE * sbE;
      d = `M ${px1} ${py1} L ${px2} ${py2}`;
    }

    this._path.setAttribute('d', d);
    this._path.setAttribute('fill', 'none');
    this._path.setAttribute('stroke', stroke);
    this._path.setAttribute('stroke-width', strokeWidth);
    this._path.setAttribute('stroke-dasharray', this._strokeDashArray());
    this._path.setAttribute('stroke-linecap', 'round');

    // Pass correct tangent direction to _renderCap via a synthetic "from" point:
    //   _renderCap computes direction = (tipX - fromX, tipY - fromY)
    //   For the start cap, we want the tip to point outwards (away from the line),
    //   so fromX should be a point inside the line: x1 + uxS.
    this._renderCap(this._capS, x1, y1, x1 + uxS, y1 + uyS, this.arrowStart, true);
    this._renderCap(this._capE, x2, y2, x2 - uxE, y2 - uyE, this.arrowEnd, false);
  }

  /**
   * How far to pull the path endpoint back from the arrowhead tip so the
   * round linecap sits entirely inside the arrowhead body.
   *
   * Derivation for filled triangle (half-width sw = arrowSize * 0.55):
   *   At position `d` behind the tip, the triangle's half-width = sw * d / s.
   *   The round cap radius = strokeWidth / 2.
   *   They meet when sw * d / s = strokeWidth / 2  →  d = strokeWidth * s / (2*sw)
   *                                                   = strokeWidth / (2*0.55)
   *                                                   ≈ strokeWidth / 1.1
   * Capped at 80 % of arrowSize to ensure the endpoint stays within the head.
   */
  _arrowSetback(style) {
    if (style === 'none' || style === 'open') return 0;
    return Math.min(this.strokeWidth / 1.1, this.arrowSize * 0.8);
  }


  _renderCap(g, tipX, tipY, fromX, fromY, style, isStart) {
    while (g.firstChild) g.firstChild.remove();
    if (style === 'none') return;

    const dx = tipX - fromX, dy = tipY - fromY;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len === 0) return;
    const ux = dx / len, uy = dy / len;
    const nx = -uy, ny = ux;
    const { stroke, strokeWidth } = this;

    // The path has already been shortened so the round linecap sits inside the
    // arrowhead — no outward tip shift is needed here.

    const s = this.arrowSize;
    const sw = s * 0.55;

    if (style === 'filled' || style === 'double') {
      const pts = [
        [tipX, tipY],
        [tipX - s * ux + sw * nx, tipY - s * uy + sw * ny],
        [tipX - s * ux - sw * nx, tipY - s * uy - sw * ny],
      ].map(([x, y]) => `${x},${y}`).join(' ');
      g.appendChild(this.makeSVGEl('polygon', { points: pts, fill: stroke, stroke: 'none' }));
      if (style === 'double') {
        const pts2 = [
          [tipX - s * ux, tipY - s * uy],
          [tipX - 2 * s * ux + sw * nx, tipY - 2 * s * uy + sw * ny],
          [tipX - 2 * s * ux - sw * nx, tipY - 2 * s * uy - sw * ny],
        ].map(([x, y]) => `${x},${y}`).join(' ');
        g.appendChild(this.makeSVGEl('polygon', { points: pts2, fill: stroke, stroke: 'none' }));
      }
    } else if (style === 'open') {
      const p1 = `${tipX - s * ux + sw * nx},${tipY - s * uy + sw * ny}`;
      const p2 = `${tipX},${tipY}`;
      const p3 = `${tipX - s * ux - sw * nx},${tipY - s * uy - sw * ny}`;
      g.appendChild(this.makeSVGEl('path', {
        d: `M ${p1} L ${p2} L ${p3}`, fill: 'none',
        stroke, 'stroke-width': strokeWidth, 'stroke-linecap': 'round',
      }));
    } else if (style === 'circle') {
      const cx = tipX - (s / 2) * ux;
      const cy = tipY - (s / 2) * uy;
      g.appendChild(this.makeSVGEl('circle', { cx, cy, r: s / 2, fill: stroke, stroke: 'none' }));
    } else if (style === 'square') {
      const hx = (s / 2) * ux, hy = (s / 2) * uy;
      const px = (s / 2) * nx, py = (s / 2) * ny;
      const cx = tipX - hx, cy = tipY - hy;
      const pts = [
        [cx - px, cy - py], [cx + px, cy + py],
        [cx + hx + px, cy + hy + py], [cx + hx - px, cy + hy - py],
      ].map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
      g.appendChild(this.makeSVGEl('polygon', { points: pts, fill: stroke, stroke: 'none' }));
    }
  }

  // ─── Overrides ────────────────────────────────────────────────────────────

  getBBox() {
    const { x: x1, y: y1, x2, y2 } = this;

    if (this.lineMode === 'elbow') {
      let j1x = this.cpx, j1y = this.cpy;
      if (j1x === null || j1y === null) { j1x = (x1 + x2) / 2; j1y = y1; }
      let j2x = x2, j2y = y2;
      const v1x = j1x - x1, v1y = j1y - y1;
      const v1Sq = v1x * v1x + v1y * v1y;
      if (v1Sq > 1e-6) {
        const k = ((x2 - j1x) * v1x + (y2 - j1y) * v1y) / v1Sq;
        j2x = x2 - k * v1x;
        j2y = y2 - k * v1y;
      }
      const xs = [x1, x2, j1x, j2x];
      const ys = [y1, y2, j1y, j2y];
      return {
        x: Math.min(...xs),
        y: Math.min(...ys),
        w: Math.max(...xs) - Math.min(...xs) || 1,
        h: Math.max(...ys) - Math.min(...ys) || 1,
      };
    }

    if (this.lineMode === 'curve') {
      // Compute effective control point (same formula as render())
      let cpx = this.cpx, cpy = this.cpy;
      if (cpx === null) {
        const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
        const dl = Math.hypot(x2 - x1, y2 - y1) || 1;
        cpx = mx + (-(y2 - y1) / dl) * dl * 0.25;
        cpy = my + ( (x2 - x1) / dl) * dl * 0.25;
      }
      // Quadratic Bézier extremum for one axis: t = (p0 - p1) / (p0 - 2p1 + p2)
      const extreme = (p0, p1, p2) => {
        const denom = p0 - 2 * p1 + p2;
        if (Math.abs(denom) < 1e-9) return [];
        const t = (p0 - p1) / denom;
        if (t <= 0 || t >= 1) return [];
        const mt = 1 - t;
        return [mt * mt * p0 + 2 * mt * t * p1 + t * t * p2];
      };
      const xs = [x1, x2, ...extreme(x1, cpx, x2)];
      const ys = [y1, y2, ...extreme(y1, cpy, y2)];
      return {
        x: Math.min(...xs),
        y: Math.min(...ys),
        w: Math.max(...xs) - Math.min(...xs) || 1,
        h: Math.max(...ys) - Math.min(...ys) || 1,
      };
    }

    // Straight line
    return {
      x: Math.min(x1, x2),
      y: Math.min(y1, y2),
      w: Math.max(x1, x2) - Math.min(x1, x2) || 1,
      h: Math.max(y1, y2) - Math.min(y1, y2) || 1,
    };
  }

  hitTest(wx, wy) {
    const { x: x1, y: y1, x2, y2 } = this;
    const thr = Math.max(6, this.strokeWidth + 4);

    // Helper: distance from point (px,py) to segment (ax,ay)→(bx,by)
    const segDist = (px, py, ax, ay, bx, by) => {
      const ddx = bx - ax, ddy = by - ay;
      const lenSq = ddx * ddx + ddy * ddy;
      if (lenSq === 0) return Math.hypot(px - ax, py - ay);
      const t = Math.max(0, Math.min(1, ((px - ax) * ddx + (py - ay) * ddy) / lenSq));
      return Math.hypot(px - (ax + t * ddx), py - (ay + t * ddy));
    };

    if (this.lineMode === 'elbow') {
      let j1x = this.cpx, j1y = this.cpy;
      if (j1x === null || j1y === null) { j1x = (x1 + x2) / 2; j1y = y1; }
      let j2x = x2, j2y = y2;
      const v1x = j1x - x1, v1y = j1y - y1;
      const v1Sq = v1x * v1x + v1y * v1y;
      if (v1Sq > 1e-6) {
        const k = ((x2 - j1x) * v1x + (y2 - j1y) * v1y) / v1Sq;
        j2x = x2 - k * v1x;
        j2y = y2 - k * v1y;
      }
      return segDist(wx, wy, x1, y1, j1x, j1y) <= thr ||
             segDist(wx, wy, j1x, j1y, j2x, j2y) <= thr ||
             segDist(wx, wy, j2x, j2y, x2, y2) <= thr;
    }

    if (this.lineMode === 'curve') {
      // Sample along the quadratic bezier
      let cpx = this.cpx, cpy = this.cpy;
      if (cpx === null) {
        const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
        const dl = Math.hypot(x2 - x1, y2 - y1) || 1;
        cpx = mx + (-(y2 - y1) / dl) * dl * 0.25;
        cpy = my + ( (x2 - x1) / dl) * dl * 0.25;
      }
      for (let i = 0; i <= 20; i++) {
        const t = i / 20, mt = 1 - t;
        const qx = mt * mt * x1 + 2 * mt * t * cpx + t * t * x2;
        const qy = mt * mt * y1 + 2 * mt * t * cpy + t * t * y2;
        if (Math.hypot(wx - qx, wy - qy) <= thr) return true;
      }
      return false;
    }

    // Straight line
    return segDist(wx, wy, x1, y1, x2, y2) <= thr;
  }


  translate(dx, dy) {
    this.x  += dx; this.y  += dy;
    this.x2 += dx; this.y2 += dy;
    if (this.cpx !== null) { this.cpx += dx; this.cpy += dy; }
    this.render();
  }

  snapshotState() {
    return { x: this.x, y: this.y, x2: this.x2, y2: this.y2, cpx: this.cpx, cpy: this.cpy };
  }

  applyState(s) { Object.assign(this, s); }

  serialize() {
    return {
      ...super.serialize(),
      x2: this.x2, y2: this.y2, cpx: this.cpx, cpy: this.cpy,
      arrowStart: this.arrowStart, arrowEnd: this.arrowEnd,
      lineMode: this.lineMode, arrowSize: this.arrowSize,
    };
  }

  static deserialize(data) { return new LineShape(data); }
}
