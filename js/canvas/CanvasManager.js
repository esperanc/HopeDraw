import { Events } from '../core/Events.js';

/**
 * Manages the SVG canvas element: zoom, pan, coordinate transforms,
 * and routing pointer events to the active tool.
 */
export class CanvasManager {
  constructor(bus, svgEl) {
    this.bus        = bus;
    this.svg        = svgEl;
    this.root       = svgEl.getElementById('canvas-root') ?? svgEl.querySelector('#canvas-root');
    this.shapesLayer= svgEl.querySelector('#shapes-layer');
    this.handlesLayer= svgEl.querySelector('#handles-layer');

    this.zoom   = 1;
    this.panX   = 0;
    this.panY   = 0;

    this._activeTool = null;
    this._panning    = false;
    this._lastPan    = null;
    this._showGrid   = true;
    this.snapToGrid  = false;   // snap-to-grid enabled flag
    this.gridSize    = 20;      // snap grid size in world units


    this._bindEvents();
    this._updateTransform();
  }

  setActiveTool(tool) {
    this._activeTool = tool;
  }

  // ─── Coordinate Transforms ────────────────────────────────────────────────

  /** Convert a client (screen) point to world (canvas) coordinates */
  clientToWorld(clientX, clientY) {
    const rect = this.svg.getBoundingClientRect();
    const svgX = clientX - rect.left;
    const svgY = clientY - rect.top;
    return {
      x: (svgX - this.panX) / this.zoom,
      y: (svgY - this.panY) / this.zoom,
    };
  }

  /** Convert a world point to client (screen) coordinates */
  worldToClient(wx, wy) {
    const rect = this.svg.getBoundingClientRect();
    return {
      x: wx * this.zoom + this.panX + rect.left,
      y: wy * this.zoom + this.panY + rect.top,
    };
  }

  // ─── Zoom / Pan ───────────────────────────────────────────────────────────

  zoomBy(factor, pivotX, pivotY) {
    const newZoom = Math.max(0.1, Math.min(10, this.zoom * factor));
    if (pivotX !== undefined) {
      // Zoom toward the pivot point (in SVG element coords)
      const rect = this.svg.getBoundingClientRect();
      const sx = pivotX - rect.left;
      const sy = pivotY - rect.top;
      this.panX = sx - (sx - this.panX) * (newZoom / this.zoom);
      this.panY = sy - (sy - this.panY) * (newZoom / this.zoom);
    }
    this.zoom = newZoom;
    this._updateTransform();
    this.bus.emit(Events.ZOOM_CHANGED, { zoom: this.zoom });
  }

  zoomTo(z) { this.zoomBy(z / this.zoom); }

  resetView() {
    this.zoom = 1; this.panX = 0; this.panY = 0;
    this._updateTransform();
    this.bus.emit(Events.ZOOM_CHANGED, { zoom: 1 });
  }

  /**
   * Translate the canvas so that the page rectangle (0,0,pageW,pageH)
   * appears centred in the SVG viewport at the current zoom level.
   */
  centerOnPage(pageW, pageH) {
    const rect = this.svg.getBoundingClientRect();
    this.panX = (rect.width  - pageW * this.zoom) / 2;
    this.panY = (rect.height - pageH * this.zoom) / 2;
    this._updateTransform();
  }

  toggleGrid() {
    this._showGrid = !this._showGrid;
    const gridBg   = this.svg.querySelector('#grid-bg');
    const pageGrid = this.svg.querySelector('#page-grid');
    if (gridBg)   gridBg.style.display   = this._showGrid ? '' : 'none';
    if (pageGrid) pageGrid.style.display = this._showGrid ? '' : 'none';
    this.bus.emit(Events.GRID_TOGGLED, { visible: this._showGrid });
  }

  /** Toggle snap-to-grid on/off */
  toggleSnap() {
    this.snapToGrid = !this.snapToGrid;
    this.bus.emit(Events.SNAP_CHANGED, { snap: this.snapToGrid, gridSize: this.gridSize });
  }

  /** Explicitly set snap state */
  setSnap(enabled) {
    this.snapToGrid = enabled;
    this.bus.emit(Events.SNAP_CHANGED, { snap: this.snapToGrid, gridSize: this.gridSize });
  }

  /**
   * Set the grid size (in world/SVG units) and update the visual grid patterns
   * so they always match the snap grid.
   */
  setGridSize(size) {
    this.gridSize = Math.max(1, size);
    // Update minor grid patterns (one cell = gridSize)
    for (const id of ['grid-pattern', 'page-grid-pattern']) {
      const pat = this.svg.querySelector(`#${id}`);
      if (pat) {
        pat.setAttribute('width',  this.gridSize);
        pat.setAttribute('height', this.gridSize);
        const path = pat.querySelector('path');
        if (path) {
          path.setAttribute('d', `M ${this.gridSize} 0 L 0 0 0 ${this.gridSize}`);
        }
      }
    }
    // Update major grid patterns (5 × minor = one major cell)
    const major = this.gridSize * 5;
    for (const id of ['grid-pattern-major', 'page-grid-pattern-major']) {
      const pat = this.svg.querySelector(`#${id}`);
      if (pat) {
        pat.setAttribute('width',  major);
        pat.setAttribute('height', major);
        const rect = pat.querySelector('rect');
        if (rect) {
          rect.setAttribute('width',  major);
          rect.setAttribute('height', major);
        }
        const path = pat.querySelector('path');
        if (path) {
          path.setAttribute('d', `M ${major} 0 L 0 0 0 ${major}`);
        }
      }
    }
    this.bus.emit(Events.SNAP_CHANGED, { snap: this.snapToGrid, gridSize: this.gridSize });
  }

  /**
   * Snap a single world-coordinate value to the nearest grid line.
   * Returns the value unchanged if snap is disabled.
   */
  snap(v) {
    if (!this.snapToGrid) return v;
    return Math.round(v / this.gridSize) * this.gridSize;
  }

  /** Snap a {x, y} point to grid */
  snapPt(x, y) {
    return { x: this.snap(x), y: this.snap(y) };
  }


  _updateTransform() {
    this.root.setAttribute('transform',
      `translate(${this.panX},${this.panY}) scale(${this.zoom})`);
  }

  // ─── Events ───────────────────────────────────────────────────────────────

  _bindEvents() {
    const svg = this.svg;

    svg.addEventListener('pointerdown', this._onPointerDown.bind(this));
    svg.addEventListener('pointermove', this._onPointerMove.bind(this));
    svg.addEventListener('pointerup',   this._onPointerUp.bind(this));
    svg.addEventListener('pointerleave',this._onPointerUp.bind(this));
    svg.addEventListener('wheel',       this._onWheel.bind(this), { passive: false });
    svg.addEventListener('contextmenu', this._onContextMenu.bind(this));
    svg.addEventListener('dblclick',    this._onDblClick.bind(this));

    // Track cursor position
    svg.addEventListener('mousemove', (e) => {
      const w = this.clientToWorld(e.clientX, e.clientY);
      const pos = document.getElementById('cursor-pos');
      if (pos) pos.textContent = `${w.x.toFixed(0)}, ${w.y.toFixed(0)}`;
    });

    // Spacebar panning
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && !this._spacebarPan) {
        // Ignore if typing in an input/textarea
        if (['INPUT', 'TEXTAREA'].includes(e.target.tagName) || e.target.isContentEditable) return;
        e.preventDefault();
        this._spacebarPan = true;
        this.svg.style.cursor = 'grab';
      }
    });

    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') {
        this._spacebarPan = false;
        if (!this._panning) this.svg.style.cursor = ''; // Reset cursor if not mid-drag
      }
    });
  }

  _onPointerDown(e) {
    if (e.button === 1 || (e.button === 0 && e.altKey) || (e.button === 0 && this._spacebarPan)) {
      // Middle click, Alt+drag, or Space+drag → pan
      e.preventDefault();
      this._panning = true;
      if (this._spacebarPan) this.svg.style.cursor = 'grabbing';
      this._lastPan = { x: e.clientX, y: e.clientY };
      this.svg.setPointerCapture(e.pointerId);
      return;
    }
    if (this._activeTool?.onPointerDown) {
      const w = this.clientToWorld(e.clientX, e.clientY);
      this._activeTool.onPointerDown(w.x, w.y, e);
    }
  }

  _onPointerMove(e) {
    if (this._panning && this._lastPan) {
      this.panX += e.clientX - this._lastPan.x;
      this.panY += e.clientY - this._lastPan.y;
      this._lastPan = { x: e.clientX, y: e.clientY };
      this._updateTransform();
      return;
    }
    if (this._activeTool?.onPointerMove) {
      const w = this.clientToWorld(e.clientX, e.clientY);
      this._activeTool.onPointerMove(w.x, w.y, e);
    }
  }

  _onPointerUp(e) {
    if (this._panning) {
      this._panning = false;
      this._lastPan = null;
      if (this.svg.hasPointerCapture(e.pointerId)) {
        this.svg.releasePointerCapture(e.pointerId);
      }
      this.svg.style.cursor = this._spacebarPan ? 'grab' : '';
      return;
    }
    if (this._activeTool?.onPointerUp) {
      const w = this.clientToWorld(e.clientX, e.clientY);
      this._activeTool.onPointerUp(w.x, w.y, e);
    }
  }

  _onWheel(e) {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      // Pinch-to-zoom or Ctrl+Scroll
      const factor = e.deltaY < 0 ? 1.05 : 1 / 1.05; // Milder zoom factor for wheel
      this.zoomBy(factor, e.clientX, e.clientY);
    } else {
      // Trackpad / Scroll wheel panning
      this.panX -= e.deltaX;
      this.panY -= e.deltaY;
      this._updateTransform();
    }
  }

  _onDblClick(e) {
    if (this._activeTool?.onDblClick) {
      const w = this.clientToWorld(e.clientX, e.clientY);
      this._activeTool.onDblClick(w.x, w.y, e);
    }
  }

  _onContextMenu(e) {
    e.preventDefault();
    if (this._activeTool?.onContextMenu) {
      this._activeTool.onContextMenu(e.clientX, e.clientY, e);
    }
  }
}
