import { Events }          from './core/Events.js';
import { EventBus }         from './core/EventBus.js';
import { CommandManager, AddShapesCommand, RemoveShapesCommand }   from './core/CommandManager.js?buster=1';
import { LayerManager }     from './core/LayerManager.js';
import { ProjectManager }   from './core/ProjectManager.js';
import { CanvasManager }    from './canvas/CanvasManager.js';
import { SelectionManager } from './canvas/SelectionManager.js';

import { RectShape }          from './shapes/RectShape.js';
import { EllipseShape }       from './shapes/EllipseShape.js';
import { ArcShape }           from './shapes/ArcShape.js';
import { LineShape }          from './shapes/LineShape.js';
import { ParallelogramShape } from './shapes/ParallelogramShape.js';
import { TextShape }          from './shapes/TextShape.js';
import { FormulaShape }       from './shapes/FormulaShape.js';
import { GroupShape }         from './shapes/GroupShape.js';
import { PathShape }          from './shapes/PathShape.js';


import { SelectTool }       from './tools/SelectTool.js';
import { RectTool }         from './tools/RectTool.js';
import { EllipseTool }      from './tools/EllipseTool.js';
import { ArcTool }          from './tools/ArcTool.js';
import { LineTool }         from './tools/LineTool.js';
import { ParallelogramTool }from './tools/ParallelogramTool.js';
import { TextTool }         from './tools/TextTool.js';
import { FormulaTool }      from './tools/FormulaTool.js';
import { HandTool }         from './tools/HandTool.js';
import { PathTool }         from './tools/PathTool.js';
import { PathEditTool }     from './tools/PathEditTool.js';
import { LineEditTool }     from './tools/LineEditTool.js';
import { ArcEditTool }      from './tools/ArcEditTool.js';


import { PropertiesPanel }  from './ui/PropertiesPanel.js';
import { LayersPanel }      from './ui/LayersPanel.js';
import { ProjectMenu }      from './ui/ProjectMenu.js';

// ─── App Object ──────────────────────────────────────────────────────────────

const app = {
  bus:      new EventBus(),
  shapes:   new Map(),    // id -> Shape instance
  commands: null,
  layers:   null,
  projects: null,
  canvas:   null,
  selection:null,
  tools:    {},
  _activeTool: null,
  _activeToolName: null,
  _clipboard: [],

  /** Shape registry for deserialization */
  shapeRegistry: {
    rect:          RectShape,
    ellipse:       EllipseShape,
    arc:           ArcShape,
    line:          LineShape,
    parallelogram: ParallelogramShape,
    text:          TextShape,
    formula:       FormulaShape,
    group:         GroupShape,
    path:          PathShape,
  },


  /** Default fill/stroke props applied to new shapes */
  defaultProps: {
    base: {
      fill:        '#4a9eff',
      stroke:      '#1a1a2e',
      strokeWidth: 2,
      opacity:     1,
    },
    line: {
      arrowStart: 'none',
      arrowEnd:   'none',
    }
    // shapeType: { ...overrides }
  },

  /** Get merged default properties for a specific shape type */
  getDefaultProps(type) {
    return { ...this.defaultProps.base, ...(this.defaultProps[type] || {}) };
  },

  /** Update default property specifically for a shape type */
  setDefaultProp(type, prop, value) {
    if (!this.defaultProps[type]) {
      this.defaultProps[type] = {};
    }
    this.defaultProps[type][prop] = value;
  },

  setActiveTool(name, clearSelection = false) {
    // Group/ungroup are one-shot actions, not persistent tool modes.
    // Handle them BEFORE the tool-lookup guard so they always fire.
    if (name === 'group')   { this._doGroup();   return; }
    if (name === 'ungroup') { this._doUngroup(); return; }

    if (clearSelection) this.selection.clear();

    if (this._activeTool?.deactivate) this._activeTool.deactivate();
    const tool = this.tools[name];
    if (!tool) return;
    this._activeTool = tool;
    this._activeToolName = name;
    this.canvas.setActiveTool(tool);
    if (tool.activate) tool.activate();
    // Update toolbar UI
    document.querySelectorAll('.tool-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tool === name);
    });
    this.bus.emit(Events.TOOL_CHANGED, { name });
  },

  /** Open the LaTeX formula editor for a FormulaShape */
  openFormulaEditor(shape) {
    const editor  = document.getElementById('formula-editor');
    const input   = document.getElementById('formula-input');
    const preview = document.getElementById('formula-preview');
    const btnOk   = document.getElementById('formula-ok');
    const btnCancel = document.getElementById('formula-cancel');
    const btnClose  = document.getElementById('formula-close');

    input.value = shape.latex ?? '';
    this._renderFormulaPreview(input.value, preview);
    editor.style.display = 'flex';

    const update = () => this._renderFormulaPreview(input.value, preview);
    input.addEventListener('input', update);

    const close = () => {
      editor.style.display = 'none';
      input.removeEventListener('input', update);
    };

    btnOk.onclick = () => {
      const before = { latex: shape.latex, display: shape.display };
      const display = input.value.includes('$$') || !input.value.includes('$');
      const latex  = input.value.replace(/\$\$/g, '').replace(/\$/g, '').trim();
      const after  = { latex, display };
      shape.latex   = latex;
      shape.display = display;
      shape.render();
      this.commands.execute({
        label: 'Edit formula',
        execute: () => { Object.assign(shape, after);  shape.render(); },
        undo:    () => { Object.assign(shape, before); shape.render(); },
      });
      close();
    };
    btnCancel.onclick = close;
    btnClose.onclick  = close;
  },

  _renderFormulaPreview(latex, el) {
    const clean = latex.replace(/\$\$/g, '').replace(/\$/g, '').trim();
    try {
      el.innerHTML = window.katex?.renderToString(clean || '\\square', {
        displayMode: true, throwOnError: false,
      }) ?? clean;
    } catch { el.textContent = latex; }
  },

  _doGroup() {
    const shapes = this.selection.selectedShapes();
    if (shapes.length < 2) return;
    const layerId = this.layers.getActiveLayer()?.id ?? shapes[0].layerId;
    const group = new GroupShape({ layerId }, shapes);
    this.commands.execute({
      label: 'Group',
      execute: () => {
        shapes.forEach(s => { s.unmount(); this.shapes.delete(s.id); this.layers.removeShapeFromLayer(s.id, s.layerId); });
        this.shapes.set(group.id, group);
        this.layers.addShapeToLayer(group.id, group.layerId);
        group.mount(this.canvas.shapesLayer);
        this.bus.emit(Events.SHAPE_ADDED, { shape: group });
      },
      undo: () => {
        group.unmount(); this.shapes.delete(group.id); this.layers.removeShapeFromLayer(group.id, group.layerId);
        shapes.forEach(s => { this.shapes.set(s.id, s); this.layers.addShapeToLayer(s.id, s.layerId); s.mount(this.canvas.shapesLayer); });
        this.bus.emit(Events.SHAPE_UPDATED, {});
      },
    });
    this.selection.select(group.id);
  },

  _doUngroup() {
    const shapes = this.selection.selectedShapes();
    shapes.filter(s => s.type === 'group').forEach(group => {
      const children = group.children;
      this.commands.execute({
        label: 'Ungroup',
        execute: () => {
          group.unmount(); this.shapes.delete(group.id); this.layers.removeShapeFromLayer(group.id, group.layerId);
          children.forEach(c => { this.shapes.set(c.id, c); this.layers.addShapeToLayer(c.id, c.layerId); c.mount(this.canvas.shapesLayer); });
          this.bus.emit(Events.SHAPE_ADDED, { shapes: children });
        },
        undo: () => {
          children.forEach(c => { c.unmount(); this.shapes.delete(c.id); this.layers.removeShapeFromLayer(c.id, c.layerId); });
          this.shapes.set(group.id, group); this.layers.addShapeToLayer(group.id, group.layerId); group.mount(this.canvas.shapesLayer);
          this.bus.emit(Events.SHAPE_UPDATED, {});
        },
      });
      this.selection.selectMany(children.map(c => c.id));
    });
  },

  copy() {
    const shapes = this.selection.selectedShapes();
    if (!shapes.length) return;
    // Deep clone the serialized selected shapes into clipboard
    const data = JSON.parse(JSON.stringify(shapes.map(s => s.serialize())));
    this._clipboard = data;
    // Persist to localStorage for cross-instance copy/paste
    try {
      localStorage.setItem('hopedraw_clipboard', JSON.stringify(this._clipboard));
    } catch (e) { console.error('Clipboard sync failed:', e); }
  },

  cut() {
    const shapes = this.selection.selectedShapes();
    if (!shapes.length) return;
    this.copy();
    this.commands.execute(new RemoveShapesCommand(this, shapes));
    this.selection.clear();
  },

  paste() {
    // Try to sync from localStorage first
    try {
      const stored = localStorage.getItem('hopedraw_clipboard');
      if (stored) this._clipboard = JSON.parse(stored);
    } catch (e) { console.warn('Clipboard fetch failed, using local.'); }

    if (!this._clipboard || !this._clipboard.length) return;

    // We operate on a fresh deep clone of clipboard data to allow repeated pastes
    const dataClones = JSON.parse(JSON.stringify(this._clipboard));
    
    // Strip old IDs from the clades so constructors generate new ones
    const stripIds = (arr) => {
      for (const item of arr) {
        delete item.id;
        delete item.childIds; // if group
        delete item.nodes;    // path nodes will be natively reconstructed or should just be offset
        if (item.childShapes) {
          stripIds(item.childShapes);
        }
      }
    };
    stripIds(dataClones);

    // Apply offset (+20, +20) down right
    const offsetShapes = (arr, dx, dy) => {
      for (const item of arr) {
        if (item.x !== undefined) item.x += dx;
        if (item.y !== undefined) item.y += dy;
        // Lines
        if (item.x2 !== undefined) item.x2 += dx;
        if (item.y2 !== undefined) item.y2 += dy;
        if (item.cpx !== undefined) item.cpx += dx;
        if (item.cpy !== undefined) item.cpy += dy;
        // Paths
        // Note: the PathShape serialized state holds nodes, but they are nested. PathShape constructor handles 'nodes' explicitly natively
        // As a shortcut, the deserialize function reconstructs shapes, we can just deserialize them then call translate!
      }
    };
    offsetShapes(dataClones, 20, 20);

    const activeLayerId = this.layers.getActiveLayer()?.id;

    // Deserialize into real HopeDraw shapes
    const pastedShapes = dataClones.map(data => {
      const Cls = this.shapeRegistry[data.type];
      if (!Cls) return null;
      const s = Cls.deserialize(data, this.shapeRegistry);
      if (s && activeLayerId) s.layerId = activeLayerId;
      return s;
    }).filter(Boolean);

    if (!pastedShapes.length) return;

    // Apply offset post-deserialization since translate natively handles paths/groups geometrically, unlike pure JSON inspection
    offsetShapes(dataClones, -20, -20); // undo generic offset on JSON if we didn't want it messing up paths
    pastedShapes.forEach(s => s.translate(20, 20));

    this.commands.execute(new AddShapesCommand(this, pastedShapes));
    this.selection.selectMany(pastedShapes.map(s => s.id));
  },
};

// ─── Bootstrap ────────────────────────────────────────────────────────────────

function init() {
  const svgEl = document.getElementById('main-canvas');

  app.commands  = new CommandManager(app.bus);
  app.layers    = new LayerManager(app.bus);
  app.canvas    = new CanvasManager(app.bus, svgEl);
  app.selection = new SelectionManager(app.bus, app.canvas);
  app.selection.setApp(app);
  app.projects  = new ProjectManager(app.bus, app);
  app.tools     = {}; // initialize as empty object

  // Init layers
  app.layers.init();

  // Register tools
  app.tools = {
    select:         new SelectTool(app),
    rect:           new RectTool(app),
    ellipse:        new EllipseTool(app),
    arc:            new ArcTool(app),
    line:           new LineTool(app),
    parallelogram:  new ParallelogramTool(app),
    text:           new TextTool(app),
    formula:        new FormulaTool(app),
    hand:           new HandTool(app),
    pen:            new PathTool(app),
    'path-edit':    new PathEditTool(app),
    'line-edit':    new LineEditTool(app),
    'arc-edit':     new ArcEditTool(app),
  };


  // Init UI
  new PropertiesPanel(app);
  new LayersPanel(app);
  new ProjectMenu(app);

  // Toolbar button bindings
  document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
    btn.addEventListener('click', () => app.setActiveTool(btn.dataset.tool, true));
  });

  // Activate default tool
  app.setActiveTool('select');

  // Load last or create new project
  app.projects.loadLastOrNew();
  // Center the page in the viewport (defer so the SVG has layout)
  requestAnimationFrame(() => _centerView());

  // Dirty-tracking
  app.bus.on(Events.SHAPE_ADDED,   () => app.projects.markDirty());
  app.bus.on(Events.SHAPE_REMOVED, () => app.projects.markDirty());
  app.bus.on(Events.SHAPE_UPDATED, () => app.projects.markDirty());
  app.bus.on(Events.LAYER_ADDED,   () => app.projects.markDirty());
  app.bus.on(Events.LAYER_REMOVED, () => app.projects.markDirty());
  app.bus.on(Events.LAYER_UPDATED, () => app.projects.markDirty());

  // Debounced Auto-save (triggers 1 second after interaction stops)
  let saveTimeout = null;
  app.bus.on(Events.PROJECT_CHANGED, () => {
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
      if (app.projects.dirty) {
        console.log('Auto-saving...');
        app.projects.save();
      }
    }, 1000); // 1-second debounce
  });

  // Re-center the canvas whenever a project is loaded or created
  app.bus.on(Events.PROJECT_LOADED, () => requestAnimationFrame(() => _centerView()));
  app.bus.on(Events.PROJECT_NEW,    () => requestAnimationFrame(() => _centerView()));

  // Expose for debugging
  window.app = app;

  // ── Snap-to-grid controls ──────────────────────────────────────────────────
  const snapToggle   = document.getElementById('snap-toggle');
  const gridSizeInput = document.getElementById('grid-size-input');

  snapToggle?.addEventListener('change', () => {
    app.canvas.setSnap(snapToggle.checked);
  });

  gridSizeInput?.addEventListener('change', () => {
    const v = parseInt(gridSizeInput.value, 10);
    if (!isNaN(v) && v > 0) app.canvas.setGridSize(v);
  });
  // Also handle Enter key on the size field
  gridSizeInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.target.blur(); }
  });

  // Keep UI in sync when snap changes from any source
  app.bus.on(Events.SNAP_CHANGED, ({ snap, gridSize }) => {
    if (snapToggle)    snapToggle.checked   = snap;
    if (gridSizeInput) gridSizeInput.value  = gridSize;
  });

  console.log('HopeDraw initialized ✔');
}

function _centerView() {
  const proj = app.projects;
  const svg = app.canvas.svg;
  
  const attemptCenter = () => {
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      // SVG doesn't have a layout yet, try again next frame
      requestAnimationFrame(attemptCenter);
      return;
    }
    app.canvas.centerOnPage(proj.pageWidth, proj.pageHeight);
  };
  
  attemptCenter();
}

document.addEventListener('DOMContentLoaded', init);
