import { Shape } from './Shape.js';
import { PathShape } from './PathShape.js';

export class ArcShape extends Shape {
  constructor(data = {}) {
    super({
      type: 'arc',
      fill: '#4a9eff',
      ...data
    });
    this.startAngle = data.startAngle ?? -90;
    this.endAngle = data.endAngle ?? 0;
    this.arcStyle = data.arcStyle ?? 'pie';
    this.partialStroke = data.partialStroke ?? false;
  }

  serialize() {
    return {
      ...super.serialize(),
      startAngle: this.startAngle,
      endAngle: this.endAngle,
      arcStyle: this.arcStyle,
      partialStroke: this.partialStroke
    };
  }

  createElements(g) {
    this._fillPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    this._strokePath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    g.appendChild(this._fillPath);
    g.appendChild(this._strokePath);
    this._path = this._fillPath; // Retain reference for `toPathShape`
  }

  render() {
    if (!this.el) return;
    this._applyGroupTransform(this.el);
    
    const rx = Math.max(1, this.width / 2);
    const ry = Math.max(1, this.height / 2);
    const cx = this.cx;
    const cy = this.cy;

    const startRad = this.startAngle * Math.PI / 180;
    const endRad = this.endAngle * Math.PI / 180;

    // Determine exact points on the perimeter
    const x1 = cx + rx * Math.cos(startRad);
    const y1 = cy + ry * Math.sin(startRad);
    const x2 = cx + rx * Math.cos(endRad);
    const y2 = cy + ry * Math.sin(endRad);

    // SVG arc flags
    let diff = this.endAngle - this.startAngle;
    // Normalize difference so it represents the swept angle
    while (diff < 0) diff += 360;
    while (diff >= 360) diff -= 360;

    const largeArcFlag = diff > 180 ? 1 : 0;
    const sweepFlag = 1; // Always sweep clockwise from start to end

    let dArcOnly = `M ${x1} ${y1} A ${rx} ${ry} 0 ${largeArcFlag} ${sweepFlag} ${x2} ${y2}`;
    let dFull = dArcOnly;

    if (diff === 0 && this.startAngle !== this.endAngle && Math.abs(this.startAngle - this.endAngle) >= 360) {
      // Full ellipse drawn via two arcs if diff perfectly overlaps as a complete circle
      dArcOnly = `M ${cx - rx} ${cy} A ${rx} ${ry} 0 1 1 ${cx + rx} ${cy} A ${rx} ${ry} 0 1 1 ${cx - rx} ${cy}`;
      dFull = dArcOnly;
      if (this.arcStyle === 'pie') dFull += ` Z`;
    } else {
      if (this.arcStyle === 'pie') {
        dFull += ` L ${cx} ${cy} Z`;
      } else if (this.arcStyle === 'chord') {
        dFull += ` Z`;
      }
    }

    if (this.partialStroke) {
      // 1. Fill path (handles filling the full geometric shape, no stroke)
      this._fillPath.setAttribute('d', dFull);
      this._applyStrokeStyle(this._fillPath);
      this._fillPath.setAttribute('stroke', 'none');

      // 2. Stroke path (handles just the arc curve, no geometric fill)
      this._strokePath.setAttribute('d', dArcOnly);
      this._applyStrokeStyle(this._strokePath);
      this._strokePath.setAttribute('fill', 'none');
      this._strokePath.style.display = '';
    } else {
      // Default: singular path for both fill and stroke
      this._fillPath.setAttribute('d', dFull);
      this._applyStrokeStyle(this._fillPath);
      this._strokePath.style.display = 'none';
    }
  }

  getCustomHandles() {
    const rx = Math.max(1, this.width / 2);
    const ry = Math.max(1, this.height / 2);
    const cx = this.cx;
    const cy = this.cy;

    const startRad = this.startAngle * Math.PI / 180;
    const endRad = this.endAngle * Math.PI / 180;

    const protrusion = 15; // Pixels protruding outwards from the perimeter

    const vx1 = rx * Math.cos(startRad);
    const vy1 = ry * Math.sin(startRad);
    const len1 = Math.hypot(vx1, vy1) || 1;
    const x1 = cx + vx1 * (1 + protrusion / len1);
    const y1 = cy + vy1 * (1 + protrusion / len1);

    const vx2 = rx * Math.cos(endRad);
    const vy2 = ry * Math.sin(endRad);
    const len2 = Math.hypot(vx2, vy2) || 1;
    const x2 = cx + vx2 * (1 + protrusion / len2);
    const y2 = cy + vy2 * (1 + protrusion / len2);

    const rotation = this.rotation || 0;

    // Rotate custom handle positions into world space if shape is rotated
    const [wX1, wY1] = this._rotate(x1, y1, cx, cy, rotation);
    const [wX2, wY2] = this._rotate(x2, y2, cx, cy, rotation);

    return [
      { id: 'ARC_START', tx: wX1, ty: wY1, color: '#f5a623' },
      { id: 'ARC_END',   tx: wX2, ty: wY2, color: '#f5a623' }
    ];
  }

  dragHandle(handleId, wx, wy, snapshots) {
    const snap = snapshots.before.get(this.id);
    if (!snap) return;
    
    this.applyState(snap); // reset to initial dragging state
    
    // Inverse rotate world coordinates into local, unrotated space to measure angle relative to center
    const cx = this.cx;
    const cy = this.cy;
    const rotation = this.rotation || 0;
    const [lx, ly] = this._rotate(wx, wy, cx, cy, -rotation);

    const rx = Math.max(1, this.width / 2);
    const ry = Math.max(1, this.height / 2);
    let angle = Math.atan2((ly - cy) / ry, (lx - cx) / rx) * 180 / Math.PI;

    if (handleId === 'ARC_START') {
      this.startAngle = angle;
    } else if (handleId === 'ARC_END') {
      this.endAngle = angle;
    }
  }

  toPathShape() {
     // For export compatibility, convert the arc to an explicit PathShape
     // using its current SVG string.
     const d = this._path?.getAttribute('d') || '';
     // We will construct a dummy path shape. Since bezier extraction is complex, 
     // we'll leave it as a closed pure SVG string for basic export.
     // In a full implementation, we'd decompose the arc segment into cubic beziers.
     console.warn('Converting ArcShape to PathShape is approximate.');
     return new PathShape({
       ...this.serialize(),
       type: 'path',
       nodes: [], // Arc shapes converted to curves would populate this
       dStringOverride: d, // Requires a small tweak in PathShape to support overriding D
       closed: true,
       rotation: this.rotation,
       cachedBBox: this.getBBox()
     });
  }

  static deserialize(data) { return new ArcShape(data); }
}
