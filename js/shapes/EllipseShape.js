import { Shape } from './Shape.js';
import { PathShape } from './PathShape.js';

export class EllipseShape extends Shape {
  constructor(data = {}) {
    super({ type: 'ellipse', fill: '#f76b8a', ...data });
  }

  createElements(g) {
    this._ellipse = this.makeSVGEl('ellipse');
    g.appendChild(this._ellipse);
  }

  render() {
    if (!this.el) return;
    this._applyGroupTransform(this.el);
    const e = this._ellipse;
    e.setAttribute('cx', this.cx);
    e.setAttribute('cy', this.cy);
    e.setAttribute('rx', Math.max(1, this.width / 2));
    e.setAttribute('ry', Math.max(1, this.height / 2));
    this._applyStrokeStyle(e);
  }

  hitTest(wx, wy) {
    if (!this._ellipse) return this._pointInRotatedBBox(wx, wy);
    const svg = this._ellipse.ownerSVGElement;
    if (svg?.createSVGPoint) {
      try {
        const pt = svg.createSVGPoint();
        pt.x = wx; pt.y = wy;
        if (this._ellipse.isPointInStroke?.(pt)) return true;
        const hasFill = this.fill && this.fill !== 'none' && this.fill !== 'transparent';
        if (hasFill && this._ellipse.isPointInFill?.(pt)) return true;
        return false;
      } catch (_) {}
    }
    return this._pointInRotatedBBox(wx, wy);
  }

  toPathShape() {
    const k = 4 * (Math.sqrt(2) - 1) / 3;
    const { x, y, width: w, height: h, rotation } = this;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const rx = w / 2;
    const ry = h / 2;

    const unrotNodes = [
      { x: cx, y: cy - ry, cInX: cx - rx * k, cInY: cy - ry, cOutX: cx + rx * k, cOutY: cy - ry, smooth: true },
      { x: cx + rx, y: cy, cInX: cx + rx, cInY: cy - ry * k, cOutX: cx + rx, cOutY: cy + ry * k, smooth: true },
      { x: cx, y: cy + ry, cInX: cx + rx * k, cInY: cy + ry, cOutX: cx - rx * k, cOutY: cy + ry, smooth: true },
      { x: cx - rx, y: cy, cInX: cx - rx, cInY: cy + ry * k, cOutX: cx - rx, cOutY: cy - ry * k, smooth: true }
    ];

    const nodes = unrotNodes.map(n => {
      const [nx, ny] = this._rotate(n.x, n.y, cx, cy, rotation);
      const [cInX, cInY] = this._rotate(n.cInX, n.cInY, cx, cy, rotation);
      const [cOutX, cOutY] = this._rotate(n.cOutX, n.cOutY, cx, cy, rotation);
      return { x: nx, y: ny, cInX, cInY, cOutX, cOutY, smooth: n.smooth };
    });

    return new PathShape({
      ...this.serialize(),
      type: 'path',
      nodes,
      closed: true,
      rotation,
      cachedBBox: this.getBBox()
    });
  }

  static deserialize(data) { return new EllipseShape(data); }
}
