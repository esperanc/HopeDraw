import { Shape } from './Shape.js';

/**
 * Group shape – contains multiple child shapes (arbitrary nesting depth).
 *
 * Rotation architecture:
 *   rotate() bakes the transform into each child's world-space position/rotation,
 *   AND accumulates `this.rotation` (the group's own angle).  `getBBox()` returns
 *   the _cachedBBox in its unrotated form (same w/h as when the group was first
 *   created), so SelectionManager can draw it as a properly rotated rectangle using
 *   `s.rotation`.  `getRotatedCorners()` returns the four corners of that bbox
 *   rotated by `this.rotation` around its centre.
 *
 *   The cached bbox's (x, y) tracks the bbox centre as it moves through rotations
 *   and translations, but w/h are never changed by a rotation.
 *
 *   recomputeBBox() is called only on structural changes (children added/removed).
 *   It resets rotation to 0 and recomputes from the children's current positions.
 */
export class GroupShape extends Shape {
  constructor(data = {}, children = []) {
    super({ type: 'group', fill: 'none', stroke: 'none', strokeWidth: 0, ...data });
    this.children = children;
    this.childIds = data.childIds ?? children.map(c => c.id);
    // Initialise _cachedBBox (unrotated, used for handle sizing).
    if (!data.width && children.length) {
      this._cachedBBox = GroupShape._childrenBBox(children);
    } else {
      this._cachedBBox = data.width
        ? { x: data.x ?? 0, y: data.y ?? 0, w: data.width, h: data.height ?? data.width }
        : null;
    }
    // rotation may be provided by deserialized data; otherwise 0.
    this.rotation = data.rotation ?? 0;
    this._syncFromCache();
  }

  // ─── SVG lifecycle ─────────────────────────────────────────────────────────

  createElements(g) {
    this._selBox = this.makeSVGEl('rect', {
      fill: 'none', stroke: 'rgba(108,99,255,0.55)',
      'stroke-width': '1.5', 'stroke-dasharray': '5 3', rx: '3',
      'pointer-events': 'none',
      'class': 'export-ignore',
    });
    g.appendChild(this._selBox);
    this.children.forEach(child => {
      if (child.el) child.el.remove();
      child.mount(g);
    });
  }

  render() {
    if (!this.el) return;
    this.el.removeAttribute('transform');
    this.el.style.opacity = this.opacity ?? 1;
    const bb = this._cachedBBox;
    if (bb) {
      const cx = bb.x + bb.w / 2;
      const cy = bb.y + bb.h / 2;
      this._selBox.setAttribute('x',         bb.x - 6);
      this._selBox.setAttribute('y',         bb.y - 6);
      this._selBox.setAttribute('width',     bb.w + 12);
      this._selBox.setAttribute('height',    bb.h + 12);
      // Rotate the dashed outline to match the group's accumulated rotation.
      this._selBox.setAttribute('transform', `rotate(${this.rotation ?? 0},${cx},${cy})`);
    }
    this.children.forEach(c => c.render());
  }

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

  // ─── Transforms ────────────────────────────────────────────────────────────

  /** Move every child by (dx, dy) in world-space. Shift cached bbox without recomputing. */
  translate(dx, dy) {
    this.children.forEach(c => c.translate(dx, dy));
    if (this._cachedBBox) {
      this._cachedBBox = { ...this._cachedBBox, x: this._cachedBBox.x + dx, y: this._cachedBBox.y + dy };
      this._syncFromCache();
    }
    this.render();
  }

  get rotation() {
    return this._rotation ?? 0;
  }

  set rotation(val) {
    const current = this.rotation;
    const delta = val - current;
    if (Math.abs(delta) < 0.001) return;
    const bb = this._cachedBBox;
    if (bb) {
      this.rotate(delta, bb.x + bb.w / 2, bb.y + bb.h / 2);
    } else {
      this._rotation = val;
    }
  }

  /**
   * Rotate every child by `angle` degrees around world-space pivot (cx, cy).
   * Children positions/rotations are baked into world-space.
   * The group accumulates its own `this._rotation` so that SelectionManager
   * can draw a properly rotated selection rectangle — no SVG group transform needed.
   */
  rotate(angle, pivotX, pivotY) {
    GroupShape._rotateChildren(this.children, angle, pivotX, pivotY);

    // Rotate the cached bbox CENTRE around the pivot (keep w/h unchanged).
    if (this._cachedBBox) {
      const r   = angle * Math.PI / 180;
      const cos = Math.cos(r), sin = Math.sin(r);
      const ox  = this._cachedBBox.x + this._cachedBBox.w / 2;
      const oy  = this._cachedBBox.y + this._cachedBBox.h / 2;
      const dx  = ox - pivotX, dy = oy - pivotY;
      const newCx = pivotX + dx * cos - dy * sin;
      const newCy = pivotY + dx * sin + dy * cos;
      this._cachedBBox = {
        x: newCx - this._cachedBBox.w / 2,
        y: newCy - this._cachedBBox.h / 2,
        w: this._cachedBBox.w,
        h: this._cachedBBox.h,
      };
      this._syncFromCache();
    }

    // Accumulate rotation so SelectionManager can draw a rotated selection box.
    this._rotation = (this.rotation + angle + 360) % 360;
    this.render();
  }

  /**
   * Resize the group by scaling all children proportionally.
   *
   * `anchorX/Y` is the FIXED corner of the resize, expressed in the group's
   * local (pre-rotation) coordinate space — i.e., the same space as
   * `_cachedBBox.x/y/w/h`.  `scaleX/Y` are the new/old width and height ratios.
   *
   * The algorithm for each child:
   *   1. Unrotate its world position back to the group's original (pre-rotation) frame
   *      by rotating by -group.rotation around the OLD bbox centre.
   *   2. Scale the de-rotated position from the anchor.
   *   3. Re-rotate from the scaled position back to world space, this time
   *      rotating around the NEW bbox centre (because the bbox centre shifts
   *      with the anchor when scaleX ≠ 1 or scaleY ≠ 1 or the anchor isn't
   *      the bbox centre).
   */
  resize(anchorX, anchorY, scaleX, scaleY, localRotationOverride) {
    const bb    = this._cachedBBox;
    if (!bb) return;

    const θ   = (localRotationOverride ?? this.rotation ?? 0) * Math.PI / 180;
    const cos = Math.cos(θ), sin = Math.sin(θ);

    const oldCx = bb.x + bb.w / 2,    oldCy = bb.y + bb.h / 2;
    // The new center is simply the old center scaled from the anchor.
    const newCx = anchorX + (oldCx - anchorX) * scaleX;
    const newCy = anchorY + (oldCy - anchorY) * scaleY;

    // Unrotate a world-space point into the group's original pre-rotation frame
    const unrot = (px, py) => {
      const dx = px - oldCx, dy = py - oldCy;
      return [oldCx + dx * cos + dy * sin, oldCy - dx * sin + dy * cos];
    };

    // Re-rotate a scaled original-frame point back to world space (via new centre)
    const rerot = (px, py) => {
      const dx = px - newCx, dy = py - newCy;
      return [newCx + dx * cos - dy * sin, newCy + dx * sin + dy * cos];
    };

    // Scale a pre-rotation point from the anchor
    const scl = (px, py) => [
      anchorX + (px - anchorX) * scaleX,
      anchorY + (py - anchorY) * scaleY,
    ];

    const processChild = (c) => {
      if (c.type === 'line') {
        const [ox1, oy1] = unrot(c.x,  c.y);
        const [ox2, oy2] = unrot(c.x2, c.y2);
        [c.x,  c.y]  = rerot(...scl(ox1, oy1));
        [c.x2, c.y2] = rerot(...scl(ox2, oy2));
        if (c.cpx != null) {
          const [ocx, ocy] = unrot(c.cpx, c.cpy);
          [c.cpx, c.cpy] = rerot(...scl(ocx, ocy));
        }
      } else if (c.type === 'group') {
        // Scale nested group's children in the same coordinate frame.
        c.children.forEach(gc => processChild(gc));
        // Update nested group's cached bbox: scale its centre and dimensions.
        if (c._cachedBBox) {
          const cx = c._cachedBBox.x + c._cachedBBox.w / 2;
          const cy = c._cachedBBox.y + c._cachedBBox.h / 2;
          const [ocx, ocy] = unrot(cx, cy);
          const [scx, scy] = scl(ocx, ocy);
          const [wcx, wcy] = rerot(scx, scy);
          
          const A = ((c.rotation ?? 0) - (localRotationOverride ?? this.rotation ?? 0)) * Math.PI / 180;
          const scaleW = Math.hypot(scaleX * Math.cos(A), scaleY * Math.sin(A));
          const scaleH = Math.hypot(scaleX * Math.sin(A), scaleY * Math.cos(A));

          const gw = Math.max(2, Math.abs(c._cachedBBox.w * scaleW));
          const gh = Math.max(2, Math.abs(c._cachedBBox.h * scaleH));
          c._cachedBBox = { x: wcx - gw / 2, y: wcy - gh / 2, w: gw, h: gh };
          c._syncFromCache();
        }
      } else if (c.type === 'path') {
        c.nodes.forEach(n => {
          [n.x,  n.y]  = rerot(...scl(...unrot(n.x, n.y)));
          if (n.cInX != null) [n.cInX, n.cInY] = rerot(...scl(...unrot(n.cInX, n.cInY)));
          if (n.cOutX != null) [n.cOutX, n.cOutY] = rerot(...scl(...unrot(n.cOutX, n.cOutY)));
        });
        if (c._cachedBBox) {
          const cx = c._cachedBBox.x + c._cachedBBox.w / 2;
          const cy = c._cachedBBox.y + c._cachedBBox.h / 2;
          const [ocx, ocy] = unrot(cx, cy);
          const [scx, scy] = scl(ocx, ocy);
          const [wcx, wcy] = rerot(scx, scy);
          
          const A = ((c.rotation ?? 0) - (localRotationOverride ?? this.rotation ?? 0)) * Math.PI / 180;
          const scaleW = Math.hypot(scaleX * Math.cos(A), scaleY * Math.sin(A));
          const scaleH = Math.hypot(scaleX * Math.sin(A), scaleY * Math.cos(A));
          
          const gw = Math.max(2, Math.abs(c._cachedBBox.w * scaleW));
          const gh = Math.max(2, Math.abs(c._cachedBBox.h * scaleH));
          c._cachedBBox = { x: wcx - gw / 2, y: wcy - gh / 2, w: gw, h: gh };
        }
      } else {
        // Area shape: scale the centre, then update width/height and position.
        const cx = c.x + c.width / 2;
        const cy = c.y + c.height / 2;
        const [ocx, ocy] = unrot(cx, cy);
        const [scx, scy] = scl(ocx, ocy);
        const [wcx, wcy] = rerot(scx, scy);

        const A = ((c.rotation ?? 0) - (localRotationOverride ?? this.rotation ?? 0)) * Math.PI / 180;
        const scaleW = Math.hypot(scaleX * Math.cos(A), scaleY * Math.sin(A));
        const scaleH = Math.hypot(scaleX * Math.sin(A), scaleY * Math.cos(A));

        c.width  = Math.max(2, Math.abs(c.width  * scaleW));
        c.height = Math.max(2, Math.abs(c.height * scaleH));
        c.x = wcx - c.width  / 2;
        c.y = wcy - c.height / 2;
      }
      c.render();
    };

    this.children.forEach(processChild);

    // Update this group's cached bbox to the new scaled rectangle.
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

  /**
   * Recursively rotate a list of children (handles lines, nested groups, area shapes).
   */
  static _rotateChildren(children, angle, cx, cy) {
    const r   = angle * Math.PI / 180;
    const cos = Math.cos(r), sin = Math.sin(r);
    const rotatePt = (px, py) => {
      const dx = px - cx, dy = py - cy;
      return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos];
    };

    children.forEach(c => {
      if (c.type === 'line') {
        [c.x,  c.y]  = rotatePt(c.x,  c.y);
        [c.x2, c.y2] = rotatePt(c.x2 ?? c.x, c.y2 ?? c.y);
        if (c.cpx != null) [c.cpx, c.cpy] = rotatePt(c.cpx, c.cpy);
        c.rotation = ((c.rotation ?? 0) + angle + 360) % 360;
      } else if (c.type === 'group' || c.type === 'path') {
        // Delegate to the nested compound shape's own rotate()
        c.rotate(angle, cx, cy);
      } else {
        const childCx = c.x + c.width / 2;
        const childCy = c.y + c.height / 2;
        const [newCx, newCy] = rotatePt(childCx, childCy);
        c.x = newCx - c.width  / 2;
        c.y = newCy - c.height / 2;
        c.rotation = ((c.rotation ?? 0) + angle + 360) % 360;
      }
      c.render();
    });
  }

  // ─── Bbox management ───────────────────────────────────────────────────────

  /**
   * Fully recompute _cachedBBox from children's CURRENT state and reset rotation.
   * Call only on structural changes (new group, add/remove child).
   */
  recomputeBBox() {
    this._cachedBBox = GroupShape._childrenBBox(this.children);
    this.rotation    = 0;
    this._syncFromCache();
  }

  _syncFromCache() {
    const bb = this._cachedBBox;
    if (bb) { this.x = bb.x; this.y = bb.y; this.width = bb.w; this.height = bb.h; }
  }

  // ─── Hit test & bbox ───────────────────────────────────────────────────────

  hitTest(wx, wy) {
    return this.children.some(c => c.hitTest(wx, wy));
  }

  /**
   * getBBox() returns the unrotated cached bbox (same w/h as at creation).
   * This is what SelectionManager uses for handle sizing + position before
   * it applies `s.rotation` to draw the rotated selection rectangle.
   */
  getBBox() {
    return this._cachedBBox ?? super.getBBox();
  }

  /**
   * getRotatedCorners() returns the 4 corners of _cachedBBox rotated by
   * this.rotation around its centre — used by parent shapes/_childrenBBox
   * and by multi-select bbox computation in SelectionManager.
   */
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

  // ─── State snapshot (for undo) ─────────────────────────────────────────────

  snapshotState() {
    return {
      rotation:   this.rotation ?? 0,
      cachedBBox: this._cachedBBox ? { ...this._cachedBBox } : null,
      childrenStates: this.children.map(c => ({ id: c.id, state: c.snapshotState() })),
    };
  }

  applyState(state) {
    if (state?.childrenStates) {
      this.children.forEach(c => {
        const cs = state.childrenStates.find(cs => cs.id === c.id);
        if (cs) c.applyState(cs.state);
      });
    }
    // Restore the exact cached bbox from the snapshot — do NOT recompute from
    // children (which are now at baked positions and would inflate the AABB).
    if (state?.cachedBBox) {
      this._cachedBBox = { ...state.cachedBBox };
    } else {
      this.recomputeBBox();
    }
    this._rotation = state?.rotation ?? 0;
    this._syncFromCache();
    this.render();
  }

  // ─── Children bounding box ─────────────────────────────────────────────────

  static _childrenBBox(children) {
    if (!children?.length) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const expand = (px, py) => {
      if (px < minX) minX = px; if (px > maxX) maxX = px;
      if (py < minY) minY = py; if (py > maxY) maxY = py;
    };
    children.forEach(c => {
      if (c.type === 'line') {
        expand(c.x, c.y);
        expand(c.x2 ?? c.x, c.y2 ?? c.y);
      } else {
        // getRotatedCorners() handles both regular shapes and nested groups.
        const corners = typeof c.getRotatedCorners === 'function' ? c.getRotatedCorners() : null;
        if (corners?.length) {
          corners.forEach(([px, py]) => expand(px, py));
        } else {
          const bb = c.getBBox();
          if (bb) { expand(bb.x, bb.y); expand(bb.x+bb.w, bb.y); expand(bb.x+bb.w, bb.y+bb.h); expand(bb.x, bb.y+bb.h); }
        }
      }
    });
    return isFinite(minX)
      ? { x: minX, y: minY, w: Math.max(1, maxX-minX), h: Math.max(1, maxY-minY) }
      : null;
  }

  // ─── Serialization ─────────────────────────────────────────────────────────

  serialize() {
    return {
      ...super.serialize(),
      // super.serialize() already includes rotation via Shape.serialize()
      childIds:    this.children.map(c => c.id),
      childShapes: this.children.map(c => c.serialize()),
    };
  }

  static deserialize(data, shapeRegistry) {
    shapeRegistry = shapeRegistry ?? window.app?.shapeRegistry ?? {};
    const children = (data.childShapes ?? []).map(sd => {
      if (sd.type === 'group') return GroupShape.deserialize(sd, shapeRegistry);
      const Cls = shapeRegistry[sd.type];
      return Cls ? Cls.deserialize(sd) : null;
    }).filter(Boolean);
    return new GroupShape(data, children);
  }
}
