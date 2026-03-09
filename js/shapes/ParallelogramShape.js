import { Shape } from './Shape.js';

export class ParallelogramShape extends Shape {
  constructor(data = {}) {
    super({ type: 'parallelogram', fill: '#a78bfa', ...data });
    this.skewAngle = data.skewAngle ?? 20; // degrees, negative = lean left
  }

  // Returns the 4 actual polygon vertices in world coordinates (unrotated)
  _getPoints() {
    const { x, y, width: w, height: h, skewAngle } = this;
    const offset = h * Math.tan(skewAngle * Math.PI / 180);
    // offset can be negative — the shape then leans in the other direction
    return [
      [x + offset, y       ],   // top-left
      [x + w,      y       ],   // top-right
      [x + w - offset, y + h], // bottom-right
      [x,          y + h   ],   // bottom-left
    ];
  }

  createElements(g) {
    this._poly = this.makeSVGEl('polygon');
    g.appendChild(this._poly);
  }

  render() {
    if (!this.el) return;
    this._applyGroupTransform(this.el);
    const pts = this._getPoints().map(([px, py]) => `${px},${py}`).join(' ');
    this._poly.setAttribute('points', pts);
    this._applyStrokeStyle(this._poly);
  }

  /**
   * Returns the axis-aligned bounding box of the actual polygon vertices.
   * This differs from the inherited getBBox() when skewAngle is negative,
   * because the shape then extends outside the stored (x, y, width, height).
   */
  getBBox() {
    const pts = this._getPoints();
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    pts.forEach(([px, py]) => {
      if (px < minX) minX = px; if (px > maxX) maxX = px;
      if (py < minY) minY = py; if (py > maxY) maxY = py;
    });
    return { x: minX, y: minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) };
  }

  /**
   * Returns the 4 actual polygon vertices after applying the shape's rotation.
   * Uses the same rotation pivot as _applyGroupTransform (this.cx, this.cy) to
   * stay consistent with how SVG renders the shape.
   */
  getRotatedCorners() {
    const pts = this._getPoints();
    if (!this.rotation) return pts;
    // Use the stored centre (not the vertex-derived centre) so rotation pivot
    // matches _applyGroupTransform → SVG and JS agree on where the corners end up.
    const cx = this.cx, cy = this.cy;
    return pts.map(([px, py]) => this._rotate(px, py, cx, cy, this.rotation));
  }

  /**
   * Point-in-parallelogram test using the winding or cross-product method,
   * accounting for skew and rotation.
   */
  hitTest(wx, wy) {
    const corners = this.getRotatedCorners();
    return this._pointInPolygon(wx, wy, corners);
  }

  _pointInPolygon(px, py, vertices) {
    let inside = false;
    const n = vertices.length;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const [xi, yi] = vertices[i];
      const [xj, yj] = vertices[j];
      const intersect = ((yi > py) !== (yj > py)) &&
        (px < (xj - xi) * (py - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  serialize() {
    return { ...super.serialize(), skewAngle: this.skewAngle };
  }

  static deserialize(data) { return new ParallelogramShape(data); }
}
