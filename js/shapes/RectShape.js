import { Shape } from './Shape.js';
import { PathShape } from './PathShape.js';

export class RectShape extends Shape {
  constructor(data = {}) {
    super({ type: 'rect', fill: '#4a9eff', ...data });
    this.cornerRadius = data.cornerRadius ?? 0;
  }

  createElements(g) {
    this._rect = this.makeSVGEl('rect');
    g.appendChild(this._rect);
  }

  render() {
    if (!this.el) return;
    this._applyGroupTransform(this.el);
    const r = this._rect;
    r.setAttribute('x',      this.x);
    r.setAttribute('y',      this.y);
    r.setAttribute('width',  Math.max(1, this.width));
    r.setAttribute('height', Math.max(1, this.height));
    r.setAttribute('rx',     this.cornerRadius);
    r.setAttribute('ry',     this.cornerRadius);
    this._applyStrokeStyle(r);
  }

  hitTest(wx, wy) {
    if (!this._rect) return this._pointInRotatedBBox(wx, wy);
    const svg = this._rect.ownerSVGElement;
    if (svg?.createSVGPoint) {
      try {
        const pt = svg.createSVGPoint();
        pt.x = wx; pt.y = wy;
        if (this._rect.isPointInStroke?.(pt)) return true;
        const hasFill = this.fill && this.fill !== 'none' && this.fill !== 'transparent';
        if (hasFill && this._rect.isPointInFill?.(pt)) return true;
        return false;
      } catch (_) {}
    }
    return this._pointInRotatedBBox(wx, wy);
  }

  serialize() {
    return { ...super.serialize(), cornerRadius: this.cornerRadius };
  }

  toPathShape() {
    const corners = this.getRotatedCorners();
    const nodes = corners.map(([x, y]) => ({ x, y, cInX: null, cInY: null, cOutX: null, cOutY: null, smooth: false }));
    return new PathShape({
      ...this.serialize(),
      type: 'path',
      nodes,
      closed: true,
      rotation: this.rotation,
      cachedBBox: this.getBBox()
    });
  }

  static deserialize(data) { return new RectShape(data); }
}
