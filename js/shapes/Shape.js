let _idCounter = 0;

/**
 * Abstract base class for all drawable shapes.
 * Subclasses must implement: createElements(), render(), hitTest(), getBBox(), serialize().
 */
export class Shape {
  constructor(data = {}) {
    this.id        = data.id        ?? `shape-${Date.now()}-${_idCounter++}`;
    this.type      = data.type      ?? 'shape';
    this.layerId   = data.layerId   ?? null;
    this.x         = data.x         ?? 0;
    this.y         = data.y         ?? 0;
    this.width     = data.width     ?? 100;
    this.height    = data.height    ?? 80;
    this.rotation  = data.rotation  ?? 0;    // degrees
    this.fill      = data.fill      ?? '#ffffff';
    this.stroke    = data.stroke    ?? '#1a1a2e';
    this.strokeWidth = data.strokeWidth ?? 2;
    this.opacity   = data.opacity   ?? 1;
    this.strokeDash = data.strokeDash ?? 'solid'; // 'solid'|'dashed'|'dotted'
    this.el        = null;  // root SVG <g> element, set in mount()
  }

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  /** Create SVG elements and append to parentGroup */
  mount(parentGroup) {
    if (this.el) this.el.remove();
    this.el = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    this.el.setAttribute('data-id', this.id);
    this.el.setAttribute('data-type', this.type);
    this.el.style.cursor = 'move';
    this.createElements(this.el);
    this.render();
    parentGroup.appendChild(this.el);
  }

  unmount() {
    if (this.el) {
      this.el.remove();
      this.el = null;
    }
  }

  // ─── Abstract interface ────────────────────────────────────────────────────

  /** Subclass creates its specific SVG child elements inside rootG */
  createElements(rootG) { /* abstract */ }

  /** Subclass updates its SVG element attributes from current state */
  render() { /* abstract */ }

  /** Returns true if world point (x, y) is inside this shape */
  hitTest(wx, wy) {
    return this._pointInRotatedBBox(wx, wy);
  }

  /** Returns { x, y, w, h } bounding box in world coordinates (unrotated) */
  getBBox() {
    return { x: this.x, y: this.y, w: this.width, h: this.height };
  }

  /** Returns the 4 corners of the rotated bounding box */
  getRotatedCorners() {
    const { x, y, width: w, height: h } = this;
    const cx = x + w / 2, cy = y + h / 2;
    return [
      [x, y], [x + w, y], [x + w, y + h], [x, y + h]
    ].map(([px, py]) => this._rotate(px, py, cx, cy, this.rotation));
  }

  serialize() {
    return {
      id: this.id, type: this.type, layerId: this.layerId,
      x: this.x, y: this.y, width: this.width, height: this.height,
      rotation: this.rotation, fill: this.fill, stroke: this.stroke,
      strokeWidth: this.strokeWidth, opacity: this.opacity,
      strokeDash: this.strokeDash,
    };
  }

  static deserialize(data) { return new Shape(data); }

  // ─── Transform helpers ────────────────────────────────────────────────────

  translate(dx, dy) {
    this.x += dx;
    this.y += dy;
    this.render();
  }

  /** Scale relative to an anchor point */
  scaleFrom(anchor, sx, sy) {
    this.x = anchor.x + (this.x - anchor.x) * sx;
    this.y = anchor.y + (this.y - anchor.y) * sy;
    this.width  *= sx;
    this.height *= sy;
    this.render();
  }

  /** Apply a plain state snapshot (from TransformCommand) */
  applyState(state) {
    Object.assign(this, state);
  }

  /** Snapshot current state for undo */
  snapshotState() {
    return {
      x: this.x, y: this.y, width: this.width, height: this.height,
      rotation: this.rotation,
    };
  }

  // ─── Utility ──────────────────────────────────────────────────────────────

  get cx() { return this.x + this.width / 2; }
  get cy() { return this.y + this.height / 2; }

  _rotate(px, py, cx, cy, deg) {
    const r = deg * Math.PI / 180;
    const cos = Math.cos(r), sin = Math.sin(r);
    const dx = px - cx, dy = py - cy;
    return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos];
  }

  _pointInRotatedBBox(wx, wy) {
    const { x, y, width: w, height: h, rotation } = this;
    const cx = x + w / 2, cy = y + h / 2;
    // Rotate point into local space
    const [lx, ly] = this._rotate(wx, wy, cx, cy, -rotation);
    return lx >= x && lx <= x + w && ly >= y && ly <= y + h;
  }

  _applyGroupTransform(el) {
    const cx = this.cx, cy = this.cy;
    el.setAttribute('transform', `rotate(${this.rotation},${cx},${cy})`);
    el.style.opacity = this.opacity;
  }

  _strokeDashArray() {
    if (this.strokeDash === 'dashed') return `${this.strokeWidth * 4},${this.strokeWidth * 2}`;
    if (this.strokeDash === 'dotted') return `${this.strokeWidth},${this.strokeWidth * 2}`;
    return 'none';
  }

  _applyStrokeStyle(el) {
    el.setAttribute('fill', this.fill);
    el.setAttribute('stroke', this.stroke);
    el.setAttribute('stroke-width', this.strokeWidth);
    el.setAttribute('stroke-dasharray', this._strokeDashArray());
  }

  makeSVGEl(tag, attrs = {}) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
    return el;
  }
}
