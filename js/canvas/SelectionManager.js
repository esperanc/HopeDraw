import { Events } from '../core/Events.js';

const HANDLE_SIZE = 8;   // px in world coords / zoom
const ROTATE_OFFSET = 28;

/**
 * Manages the selection state and draws transform handles.
 * Provides hit-testing for handles and delegates transforms to shapes.
 */
export class SelectionManager {
  constructor(bus, canvas) {
    this.bus    = bus;
    this.canvas = canvas;
    this._ids   = new Set();
    this._app   = null;
    this._handleEls   = [];   // individual handle elements for hit-testing
    this._handlesGroup = null; // wrapper <g> — rotate this for live preview
    this._rotateEl   = null;
    this._rotateLinEl = null;
    this._anchor = null;
  }

  setApp(app) {
    this._app = app;
    // Redraw handles on zoom/pan so they maintain constant screen size
    this.bus.on(Events.ZOOM_CHANGED,   () => { if (this.count) this._redrawHandles(); });
    this.bus.on(Events.PROJECT_CHANGED,() => { if (this.count) this._redrawHandles(); });
  }

  // ─── Selection State ──────────────────────────────────────────────────────

  get selectedIds() { return [...this._ids]; }
  get count() { return this._ids.size; }
  get isEmpty() { return this._ids.size === 0; }

  select(id, additive = false) {
    if (!additive) this._ids.clear();
    this._ids.add(id);
    this._redrawHandles();
    this._notify();
  }

  selectMany(ids) {
    this._ids = new Set(ids);
    this._redrawHandles();
    this._notify();
  }

  deselect(id) {
    this._ids.delete(id);
    this._redrawHandles();
    this._notify();
  }

  clear() {
    this._ids.clear();
    this._clearHandles();
    this._notify();
  }

  toggle(id) {
    if (this._ids.has(id)) this.deselect(id);
    else this.select(id, true);
  }

  hasSelectedFor(id) { return this._ids.has(id); }

  selectedShapes() {
    if (!this._app) return [];
    return [...this._ids].map(id => this._app.shapes.get(id)).filter(Boolean);
  }

  _notify() {
    const info = document.getElementById('selection-info');
    if (info) {
      info.textContent = this._ids.size === 0
        ? 'No selection'
        : `${this._ids.size} shape${this._ids.size > 1 ? 's' : ''} selected`;
    }
    this.bus.emit(Events.SELECTION_CHANGED, { ids: [...this._ids] });
  }

  // ─── Handles ─────────────────────────────────────────────────────────────

  /** Redraw handles for current selection */
  _redrawHandles() {
    this._clearHandles();
    const shapes = this.selectedShapes();
    if (!shapes.length) return;

    let x, y, w, h, cx, cy, rotation;

    if (shapes.length === 1) {
      const s = shapes[0];
      if (s.type === 'line') {
        rotation = 0;
        const bb = s.getBBox();
        x = bb.x; y = bb.y; w = bb.w; h = bb.h;
      } else {
        rotation = s.rotation ?? 0;
        const bb = s.getBBox();
        x = bb.x; y = bb.y; w = bb.w; h = bb.h;
      }
      cx = x + w / 2;
      cy = y + h / 2;
    } else {
      rotation = 0;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      const expand = (px, py) => {
        if (px < minX) minX = px; if (px > maxX) maxX = px;
        if (py < minY) minY = py; if (py > maxY) maxY = py;
      };
      shapes.forEach(s => {
        if (s.type === 'line') {
          expand(s.x, s.y); expand(s.x2 ?? s.x, s.y2 ?? s.y);
        } else {
          const corners = typeof s.getRotatedCorners === 'function' ? s.getRotatedCorners() : null;
          if (corners && corners.length) corners.forEach(([px, py]) => expand(px, py));
          else { const bb = s.getBBox(); if (bb) { expand(bb.x, bb.y); expand(bb.x+bb.w, bb.y); expand(bb.x+bb.w, bb.y+bb.h); expand(bb.x, bb.y+bb.h); } }
        }
      });
      if (!isFinite(minX)) return;
      x = minX; y = minY; w = maxX - minX; h = maxY - minY;
      cx = x + w / 2; cy = y + h / 2;
    }

    const layer = this.canvas.handlesLayer;

    // ── Wrapper group: rotating this gives the live preview during drag ────
    const grp = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    this._handlesGroup = grp;
    layer.appendChild(grp);

    // Selection rectangle
    const selRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    selRect.setAttribute('x', x); selRect.setAttribute('y', y);
    selRect.setAttribute('width', w); selRect.setAttribute('height', h);
    selRect.setAttribute('fill', 'none');
    selRect.setAttribute('stroke', '#6c63ff');
    selRect.setAttribute('stroke-width', 1 / this.canvas.zoom);
    selRect.setAttribute('stroke-dasharray', `${4/this.canvas.zoom} ${2/this.canvas.zoom}`);
    selRect.setAttribute('transform', `rotate(${rotation},${cx},${cy})`);
    selRect.setAttribute('pointer-events', 'none');
    grp.appendChild(selRect);

    // Resize & rotate handles
    const handles = [
      { id: 'TL', tx: x,     ty: y     }, { id: 'T',  tx: cx,    ty: y     },
      { id: 'TR', tx: x + w, ty: y     }, { id: 'ML', tx: x,     ty: cy    },
      { id: 'MR', tx: x + w, ty: cy    }, { id: 'BL', tx: x,     ty: y + h },
      { id: 'B',  tx: cx,    ty: y + h }, { id: 'BR', tx: x + w, ty: y + h },
    ];
    const hs = HANDLE_SIZE / this.canvas.zoom;
    handles.forEach(({ id, tx, ty }) => {
      const [rx, ry] = this._rotatePoint(tx, ty, cx, cy, rotation);
      const el = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      el.setAttribute('x', rx - hs / 2); el.setAttribute('y', ry - hs / 2);
      el.setAttribute('width', hs); el.setAttribute('height', hs);
      el.setAttribute('fill', '#ffffff'); el.setAttribute('stroke', '#6c63ff');
      el.setAttribute('stroke-width', 1 / this.canvas.zoom);
      el.setAttribute('rx', ['TL','TR','BL','BR'].includes(id) ? 1 : 0);
      el.style.cursor = this._handleCursor(id, rotation);
      el.dataset.handle = id;
      grp.appendChild(el);
      this._handleEls.push(el);
    });

    // Rotate handle
    const rotY  = y - ROTATE_OFFSET / this.canvas.zoom;
    const [rRx, rRy]   = this._rotatePoint(cx, rotY, cx, cy, rotation);
    const [lineX, lineY] = this._rotatePoint(cx, y,   cx, cy, rotation);

    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', lineX); line.setAttribute('y1', lineY);
    line.setAttribute('x2', rRx);   line.setAttribute('y2', rRy);
    line.setAttribute('stroke', '#6c63ff'); line.setAttribute('stroke-width', 1/this.canvas.zoom);
    line.setAttribute('pointer-events', 'none');
    grp.appendChild(line);

    const rotHandle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    rotHandle.setAttribute('cx', rRx); rotHandle.setAttribute('cy', rRy);
    rotHandle.setAttribute('r', (hs/2) * 1.2);
    rotHandle.setAttribute('fill', '#6c63ff'); rotHandle.setAttribute('stroke', '#fff');
    rotHandle.setAttribute('stroke-width', 1/this.canvas.zoom);
    rotHandle.style.cursor = 'crosshair';
    rotHandle.dataset.handle = 'ROTATE';
    grp.appendChild(rotHandle);
    this._handleEls.push(rotHandle);

    // Custom shape-specific handles (only for single selection)
    if (shapes.length === 1 && typeof shapes[0].getCustomHandles === 'function') {
      const customHandles = shapes[0].getCustomHandles();
      customHandles.forEach(({ id, tx, ty, color }) => {
        const el = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        el.setAttribute('cx', tx); el.setAttribute('cy', ty);
        el.setAttribute('r', hs / 1.5);
        el.setAttribute('fill', color || '#f5a623');
        el.setAttribute('stroke', '#fff');
        el.setAttribute('stroke-width', 1.5 / this.canvas.zoom);
        el.style.cursor = 'crosshair';
        el.dataset.handle = id;
        el.dataset.custom = 'true';
        grp.appendChild(el);
        this._handleEls.push(el);
      });
    }

    this._selBBox = { x, y, w, h, cx, cy, rotation };
  }

  /**
   * Rotate all handles as a rigid frame around (cx,cy) by delta degrees.
   * Called every animation frame during a rotation drag — no DOM reconstruction needed.
   */
  previewRotation(delta, cx, cy) {
    if (this._handlesGroup) {
      this._handlesGroup.setAttribute('transform', `rotate(${delta},${cx},${cy})`);
    }
  }

  _clearHandles() {
    // Removing the wrapper group removes all children in one shot.
    if (this._handlesGroup) {
      this._handlesGroup.remove();
      this._handlesGroup = null;
    }
    this._handleEls = [];
    this._selBBox   = null;
  }

  /** Returns handle ID ('TL','T',...,'ROTATE') if client coords hit a handle, else null */
  hitHandle(worldX, worldY) {
    const hs = (HANDLE_SIZE / this.canvas.zoom) * 1.5; // a bit larger hit area
    for (const el of this._handleEls) {
      const hid = el.dataset?.handle;
      if (!hid) continue;
      if (hid === 'ROTATE') {
        const cx = parseFloat(el.getAttribute('cx'));
        const cy = parseFloat(el.getAttribute('cy'));
        const r  = parseFloat(el.getAttribute('r')) * 1.5;
        if (Math.hypot(worldX - cx, worldY - cy) <= r) return hid;
      } else if (el.dataset.custom) {
        const cx = parseFloat(el.getAttribute('cx'));
        const cy = parseFloat(el.getAttribute('cy'));
        const r  = parseFloat(el.getAttribute('r')) * 1.5;
        if (Math.hypot(worldX - cx, worldY - cy) <= r) return hid;
      } else {
        const hx = parseFloat(el.getAttribute('x')) + parseFloat(el.getAttribute('width')) / 2;
        const hy = parseFloat(el.getAttribute('y')) + parseFloat(el.getAttribute('height')) / 2;
        if (Math.hypot(worldX - hx, worldY - hy) <= hs) return hid;
      }
    }
    return null;
  }

  refresh() { this._redrawHandles(); }

  _rotatePoint(px, py, cx, cy, deg) {
    const r = deg * Math.PI / 180;
    const cos = Math.cos(r), sin = Math.sin(r);
    const dx = px - cx, dy = py - cy;
    return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos];
  }

  _handleCursor(id, rotation) {
    const cursors = {
      TL: 'nw-resize', T: 'n-resize', TR: 'ne-resize',
      ML: 'w-resize',                 MR: 'e-resize',
      BL: 'sw-resize', B: 's-resize', BR: 'se-resize',
    };
    return cursors[id] ?? 'default';
  }
}
