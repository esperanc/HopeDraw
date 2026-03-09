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
    [this.x,  this.y]  = rotatePt(this.x, this.y);
    [this.x2, this.y2] = rotatePt(this.x2, this.y2);
    if (this.cpx != null) [this.cpx, this.cpy] = rotatePt(this.cpx, this.cpy);
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

    // Compute path data
    let d;
    if (this.lineMode === 'curve' && this.cpx !== null) {
      d = `M ${x1} ${y1} Q ${this.cpx} ${this.cpy} ${x2} ${y2}`;
    } else if (this.lineMode === 'elbow') {
      const mx = (x1 + x2) / 2;
      d = `M ${x1} ${y1} L ${mx} ${y1} L ${mx} ${y2} L ${x2} ${y2}`;
    } else {
      d = `M ${x1} ${y1} L ${x2} ${y2}`;
    }

    this._path.setAttribute('d', d);
    this._path.setAttribute('fill', 'none');
    this._path.setAttribute('stroke', stroke);
    this._path.setAttribute('stroke-width', strokeWidth);
    this._path.setAttribute('stroke-dasharray', this._strokeDashArray());
    this._path.setAttribute('stroke-linecap', 'round');

    // Draw arrow caps
    this._renderCap(this._capS, x1, y1, x2, y2, this.arrowStart, true);
    this._renderCap(this._capE, x2, y2, x1, y1, this.arrowEnd, false);
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

    // Shift the arrow tip outward by half the stroke width so it covers the line's 'round' linecap
    const offset = strokeWidth / 2;
    tipX += ux * offset;
    tipY += uy * offset;

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
    const minX = Math.min(this.x, this.x2);
    const minY = Math.min(this.y, this.y2);
    const maxX = Math.max(this.x, this.x2);
    const maxY = Math.max(this.y, this.y2);
    return { x: minX, y: minY, w: maxX - minX || 1, h: maxY - minY || 1 };
  }

  hitTest(wx, wy) {
    const { x: x1, y: y1, x2, y2 } = this;
    const dx = x2 - x1, dy = y2 - y1;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return Math.hypot(wx - x1, wy - y1) < 6;
    let t = ((wx - x1) * dx + (wy - y1) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    const nearX = x1 + t * dx, nearY = y1 + t * dy;
    return Math.hypot(wx - nearX, wy - nearY) <= Math.max(6, this.strokeWidth + 4);
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
