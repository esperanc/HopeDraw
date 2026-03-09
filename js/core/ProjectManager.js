import { Events } from './Events.js';

const STORAGE_KEY = 'hopedraw_projects';
const CURRENT_KEY = 'hopedraw_current';

export class ProjectManager {
  constructor(bus, app) {
    this.bus = bus;
    this.app = app;
    this._currentName = null;
    this._dirty = false;
    this.pageWidth = 800;
    this.pageHeight = 600;
    this.pageBgColor = '#ffffff';
  }

  get currentName() { return this._currentName; }
  get dirty() { return this._dirty; }

  markDirty() {
    this._dirty = true;
    this.bus.emit(Events.PROJECT_CHANGED, { name: this._currentName });
  }

  /** List all saved project names */
  listProjects() {
    try {
      const index = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      return index;
    } catch { return []; }
  }

  /** Save current scene under name */
  save(name) {
    name = name ?? this._currentName ?? 'Untitled';
    const data = this._serialize(name);
    const key = `hopedraw_proj_${name}`;
    try {
      localStorage.setItem(key, JSON.stringify(data));
      // Update index
      const index = this.listProjects();
      if (!index.includes(name)) {
        index.push(name);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(index));
      }
      localStorage.setItem(CURRENT_KEY, name);
      this._currentName = name;
      this._dirty = false;
      this.bus.emit(Events.PROJECT_SAVED, { name });
      return true;
    } catch (e) {
      console.error('Save failed:', e);
      return false;
    }
  }

  /** Load a project by name */
  load(name) {
    const key = `hopedraw_proj_${name}`;
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return false;
      const data = JSON.parse(raw);
      this._deserialize(data);
      this._currentName = name;
      this._dirty = false;
      localStorage.setItem(CURRENT_KEY, name);
      this.bus.emit(Events.PROJECT_LOADED, { name });
      return true;
    } catch (e) {
      console.error('Load failed:', e);
      return false;
    }
  }

  /** Load last project or create new */
  loadLastOrNew() {
    const last = localStorage.getItem(CURRENT_KEY);
    if (last && this.load(last)) return;
    this.newProject('Untitled');
  }

  deleteProject(name) {
    const key = `hopedraw_proj_${name}`;
    localStorage.removeItem(key);
    const index = this.listProjects().filter(n => n !== name);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(index));
    if (this._currentName === name) {
      this._currentName = null;
    }
  }

  newProject(name = 'Untitled') {
    // Clear canvas
    this.app.shapes.forEach(s => s.unmount());
    this.app.shapes.clear();
    this.app.layers.layers = [];
    this.app.layers.init();
    this.app.selection.clear();
    this.app.commands.clear();
    this._currentName = name;
    this._dirty = false;
    this.pageWidth = 800;
    this.pageHeight = 600;
    this.pageBgColor = '#ffffff';
    this.applyPageProperties();
    this.bus.emit(Events.PROJECT_NEW, { name });
  }

  /** Apply current page dimensions/color to the DOM */
  applyPageProperties() {
    const pageRect = document.getElementById('page-bg');
    if (pageRect) {
      pageRect.setAttribute('width',  this.pageWidth);
      pageRect.setAttribute('height', this.pageHeight);
      pageRect.setAttribute('fill',   this.pageBgColor === 'transparent' ? 'none' : this.pageBgColor);
    }
    const pageGrid = document.getElementById('page-grid');
    if (pageGrid) {
      pageGrid.setAttribute('width',  this.pageWidth);
      pageGrid.setAttribute('height', this.pageHeight);
    }
  }

  /** Rename current project */
  rename(newName) {
    const old = this._currentName;
    if (old) this.deleteProject(old);
    this.save(newName);
  }

  // ─── Export / Import ─────────────────────────────────────────────────

  /** Export scene as a downloadable SVG file */
  async exportSVG() {
    try {
      const shapesLayer = this.app.canvas.shapesLayer;

      // ── Rasterize formula (KaTeX) shapes ──────────────────────────────────
      // KaTeX renders HTML that depends on its external CSS. To make formulas
      // self-contained in the exported SVG, we rasterize each formula's DOM
      // node to a PNG using html2canvas and embed it as a base64 <image>.
      // We temporarily swap the live DOM (foreignObject → image), serialize,
      // then restore — so the canvas itself is never disrupted.
      const swaps = [];
      if (typeof window.html2canvas === 'function') {
        for (const [, shape] of this.app.shapes) {
          if (shape.type !== 'formula' || !shape.el) continue;
          const fo = shape.el.querySelector('foreignObject');
          if (!fo) continue;
          try {
            const canvas = await window.html2canvas(shape._wrap, {
              backgroundColor: shape.bgFill === 'transparent' ? null : shape.bgFill,
              scale: 2,
              useCORS: true,
              logging: false,
            });
            const dataUrl = canvas.toDataURL('image/png');
            const img = document.createElementNS('http://www.w3.org/2000/svg', 'image');
            img.setAttribute('x',      fo.getAttribute('x'));
            img.setAttribute('y',      fo.getAttribute('y'));
            img.setAttribute('width',  fo.getAttribute('width'));
            img.setAttribute('height', fo.getAttribute('height'));
            img.setAttribute('href', dataUrl);
            img.setAttribute('preserveAspectRatio', 'xMidYMid meet');
            fo.replaceWith(img);
            swaps.push({ img, fo });
          } catch (e) {
            console.warn('Formula rasterize failed, will export as foreignObject:', e);
          }
        }
      }

      // ── Serialize ─────────────────────────────────────────────────────────
      const serializer = new XMLSerializer();
      let shapesStr = serializer.serializeToString(shapesLayer);

      // Restore swapped formula elements before any early-exit
      for (const { img, fo } of swaps) img.replaceWith(fo);

      // Sanitize NaN values that can appear from partially-initialized shapes
      shapesStr = shapesStr.replace(/\bNaN\b/g, '0');

      // Strip KaTeX accessibility MathML nodes — they render as raw LaTeX text
      // in SVG viewers that don't understand MathML
      shapesStr = shapesStr.replace(/<span[^>]*class="[^"]*katex-mathml[^"]*"[\s\S]*?<\/span>/g, '');

      const w = this.pageWidth;
      const h = this.pageHeight;

      const svgStr = `<?xml version="1.0" encoding="utf-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
     xmlns:xlink="http://www.w3.org/1999/xlink"
     viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
  <metadata>
    <hopedraw:project xmlns:hopedraw="https://hopedraw.app/ns">
      ${JSON.stringify(this._serialize(this._currentName)).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
    </hopedraw:project>
  </metadata>
  ${this.pageBgColor !== 'transparent' ? `<rect width="100%" height="100%" fill="${this.pageBgColor}"/>` : ''}
  ${shapesStr}
</svg>`;

      this._download(svgStr, `${this._currentName ?? 'hopedraw'}.svg`, 'image/svg+xml');
    } catch (err) {
      console.error('Export SVG failed:', err);
      alert('Failed to export SVG: ' + err.message);
    }
  }



  /** Import SVG: reads HopeDraw metadata if present, else parses basic shapes */
  async importSVG(svgText) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgText, 'image/svg+xml');
    const metaEl = doc.querySelector('hopedraw\\:project, project');
    if (metaEl) {
      try {
        const data = JSON.parse(metaEl.textContent.trim()
          .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>'));
        this._deserialize(data);
        this._currentName = data.name ?? 'Imported';
        this.bus.emit(Events.PROJECT_LOADED, { name: this._currentName });
        return;
      } catch(e) { console.warn('HopeDraw metadata parse failed, falling back to raw SVG', e); }
    }
    // Fallback: create RectShapes from SVG rect elements, etc.
    // (minimal for now)
    alert('SVG imported (no HopeDraw metadata found — basic import only).');
  }

  // ─── Private ──────────────────────────────────────────────────────────

  _serialize(name) {
    return {
      version: 1,
      name,
      savedAt: new Date().toISOString(),
      pageWidth: this.pageWidth,
      pageHeight: this.pageHeight,
      pageBgColor: this.pageBgColor,
      defaultProps: this.app.defaultProps,
      layers: this.app.layers.serialize(),
      shapes: [...this.app.shapes.values()].map(s => s.serialize()),
    };
  }

  _deserialize(data) {
    this.app.shapes.forEach(s => s.unmount());
    this.app.shapes.clear();

    this.pageWidth = data.pageWidth ?? 800;
    this.pageHeight = data.pageHeight ?? 600;
    this.pageBgColor = data.pageBgColor ?? '#ffffff';
    this.applyPageProperties();

    if (data.defaultProps) {
      this.app.defaultProps = data.defaultProps;
    } else {
      // Reset to initial app defaults if missing from save data
      this.app.defaultProps = {
        base: { fill: '#4a9eff', stroke: '#1a1a2e', strokeWidth: 2, opacity: 1 }
      };
    }

    this.app.layers.deserialize(data.layers ?? []);
    if (!this.app.layers.layers.length) this.app.layers.init();

    // Dynamically import shape registry
    const shapeReg = this.app.shapeRegistry;
    (data.shapes ?? []).forEach(sd => {
      const Cls = shapeReg[sd.type];
      if (!Cls) { console.warn('Unknown shape type:', sd.type); return; }
      const shape = Cls.deserialize(sd);
      this.app.shapes.set(shape.id, shape);
      shape.mount(this.app.canvas.shapesLayer);
    });

    this.app.selection.clear();
    this.app.bus.emit(Events.PROJECT_LOADED, { name: data.name });
  }

  _getSceneBBox() {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    this.app.shapes.forEach(s => {
      const bb = s.getBBox();
      if (!bb) return;
      minX = Math.min(minX, bb.x);
      minY = Math.min(minY, bb.y);
      maxX = Math.max(maxX, bb.x + bb.w);
      maxY = Math.max(maxY, bb.y + bb.h);
    });
    if (!isFinite(minX)) return { x: 0, y: 0, w: 800, h: 600 };
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }

  _download(content, filename, mime) {
    // Use a data-URI instead of a Blob URL.
    // Blob URL downloads require a direct trusted user gesture — but our export is
    // called from inside a setTimeout (via the menu) followed by an async function,
    // which breaks the browser's trust chain on Safari and modern Chrome.
    // Data-URIs do not carry this restriction and work reliably from any context.
    const encoded = encodeURIComponent(content);
    const dataUri = `data:${mime};charset=utf-8,${encoded}`;
    const a = document.createElement('a');
    a.href = dataUri;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }
}
