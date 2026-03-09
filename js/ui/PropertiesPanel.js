import { Events } from '../core/Events.js';
import { ColorPicker } from './ColorPicker.js';

export class PropertiesPanel {
  constructor(app) {
    this.app       = app;
    this.elShape   = document.getElementById('shape-props');
    this.elPage    = document.getElementById('page-props');
    this._editing  = false;

    app.bus.on(Events.SELECTION_CHANGED, () => this.refresh());
    app.bus.on(Events.PROJECT_LOADED,    () => this.refresh());
    app.bus.on(Events.PROJECT_NEW,       () => this.refresh());
  }

  refresh() {
    if (this._editing) return;
    this._renderPageSection();
    this._renderShapeSection();
  }

  // ─── Page Setup (always visible) ──────────────────────────────────────────

  _renderPageSection() {
    const proj = this.app.projects;
    const html = `<div class="prop-section">
      <div class="prop-section-title">Page Setup</div>
      <div class="prop-row">
        <label>Width</label>
        <input type="number" id="page-prop-width" data-page-prop="pageWidth" value="${proj.pageWidth}" min="100" max="10000" step="10">
        <span class="prop-suffix">px</span>
      </div>
      <div class="prop-row">
        <label>Height</label>
        <input type="number" id="page-prop-height" data-page-prop="pageHeight" value="${proj.pageHeight}" min="100" max="10000" step="10">
        <span class="prop-suffix">px</span>
      </div>
      <div class="prop-row">
        <label>Background</label>
        <div class="color-swatch" id="page-prop-bg-swatch" data-page-prop="pageBgColor" title="Background">
          <div class="color-swatch-inner" style="${proj.pageBgColor === 'transparent' ? '' : `background-color: ${proj.pageBgColor}`}"></div>
          ${proj.pageBgColor === 'transparent' ? '<div class="color-swatch-none"></div>' : ''}
        </div>
      </div>
    </div>`;
    this.elPage.innerHTML = html;
    this._bindPageEvents();
  }

  _bindPageEvents() {
    this.elPage.querySelectorAll('input').forEach(inp => {
      inp.addEventListener('input', () => {
        const prop = inp.dataset.pageProp;
        if (!prop) return;
        let val = inp.value;
        if (inp.type === 'number') val = parseInt(val, 10) || 0;
        this.app.projects[prop] = val;
        this.app.projects.applyPageProperties();
        this.app.projects.markDirty();
        
      });
    });

    const pageBgBtn = this.elPage.querySelector('#page-prop-bg-swatch');
    if (pageBgBtn) {
      pageBgBtn.addEventListener('click', () => {
        const prop = pageBgBtn.dataset.pageProp;
        const initialVal = this.app.projects[prop];
        new ColorPicker(pageBgBtn, initialVal, (newColor) => {
          this.app.projects[prop] = newColor;
          this.app.projects.applyPageProperties();
          this.app.projects.markDirty();
          
          const isTransparent = (!newColor || newColor === 'transparent' || newColor === 'none');
          const inner = pageBgBtn.querySelector('.color-swatch-inner');
          if (inner) inner.style.backgroundColor = isTransparent ? '' : newColor;
          
          let noneLine = pageBgBtn.querySelector('.color-swatch-none');
          if (isTransparent && !noneLine) {
            pageBgBtn.insertAdjacentHTML('beforeend', '<div class="color-swatch-none"></div>');
          } else if (!isTransparent && noneLine) {
            noneLine.remove();
          }
        });
      });
    }
  }

  // ─── Shape Properties (selection-dependent) ───────────────────────────────

  _renderShapeSection() {
    const shapes = this.app.selection.selectedShapes();
    if (!shapes.length) {
      this.elShape.innerHTML = `<p class="no-selection-msg">Select a shape to edit its properties</p>`;
      return;
    }
    const s = shapes[0];

    let html = `<div class="prop-section">`;

    // Common: Fill, Stroke
    if (s.type !== 'text' && s.type !== 'formula') {
      html += this._colorRow('Fill', 'fill', s.fill);
      html += this._colorRow('Stroke', 'stroke', s.stroke);
      html += this._numRow('Stroke Width', 'strokeWidth', s.strokeWidth, 0.5, 20, 0.5);
      html += this._opacityRow(s.opacity);
      html += this._selectRow('Line Style', 'strokeDash', s.strokeDash, [
        ['solid','Solid'], ['dashed','Dashed'], ['dotted','Dotted'],
      ]);
    }

    if (s.type === 'rect') {
      html += this._numRow('Corner Radius', 'cornerRadius', s.cornerRadius, 0, 100, 1);
    }
    if (s.type === 'arc') {
      html += `</div><div class="prop-section"><div class="prop-section-title">Arc</div>`;
      html += this._selectRow('Fill Style', 'arcStyle', s.arcStyle, [['pie','Pie'], ['chord','Chord']]);
      html += this._checkboxRow('Partial Stroke', 'partialStroke', s.partialStroke);
    }
    if (s.type === 'parallelogram') {
      html += this._numRow('Skew Angle', 'skewAngle', s.skewAngle, -60, 60, 1);
    }
    if (s.type === 'line') {
      html += `</div><div class="prop-section"><div class="prop-section-title">Arrow</div>`;
      const arrowOpts = [['none','None'],['open','Open'],['filled','Filled'],['circle','Circle'],['square','Square'],['double','Double']];
      html += this._selectRow('Start', 'arrowStart', s.arrowStart, arrowOpts);
      html += this._selectRow('End',   'arrowEnd',   s.arrowEnd,   arrowOpts);
      html += this._selectRow('Mode', 'lineMode', s.lineMode, [['straight','Straight'],['elbow','Elbow'],['curve','Curve']]);
      html += this._numRow('Arrow Size', 'arrowSize', s.arrowSize, 4, 40, 1);
    }
    if (s.type === 'text') {
      html += `<div class="prop-section-title">Text</div>`;
      html += this._colorRow('Text Color', 'textColor', s.textColor);
      html += this._colorRow('Background', 'bgFill', s.bgFill ?? 'transparent');
      html += this._selectRow('Font', 'fontFamily', s.fontFamily, [
        ['Inter, sans-serif','Inter'],
        ['Arial, sans-serif','Arial'],
        ['Verdana, sans-serif','Verdana'],
        ['Tahoma, sans-serif','Tahoma'],
        ['Trebuchet MS, sans-serif','Trebuchet MS'],
        ['Impact, sans-serif','Impact'],
        ['Georgia, serif','Georgia'],
        ['Times New Roman, serif','Times New Roman'],
        ['Garamond, serif','Garamond'],
        ['Courier New, monospace','Courier New'],
        ['JetBrains Mono, monospace','JetBrains Mono'],
        ['Comic Sans MS, cursive','Comic Sans MS']
      ]);
      html += this._numRow('Font Size', 'fontSize', s.fontSize, 8, 120, 1);
      html += `<div class="prop-row prop-toggles">
        <label>Style</label>
        <div class="toggle-group">
          <button class="toggle-btn${s.fontWeight==='bold'?' active':''}" data-prop="fontWeight" data-val="bold" data-off="normal"><b>B</b></button>
          <button class="toggle-btn${s.fontStyle==='italic'?' active':''}" data-prop="fontStyle" data-val="italic" data-off="normal"><i>I</i></button>
          <button class="toggle-btn${s.textDecoration==='underline'?' active':''}" data-prop="textDecoration" data-val="underline" data-off="none"><u>U</u></button>
        </div>
      </div>`;
      html += this._selectRow('Align', 'textAlign', s.textAlign, [['left','Left'],['center','Center'],['right','Right']]);
    }
    if (s.type === 'formula') {
      html += `<div class="prop-section-title">Formula</div>`;
      html += this._colorRow('Text Color', 'textColor', s.textColor);
      html += this._colorRow('Background', 'bgFill', s.bgFill ?? 'transparent');
      html += this._numRow('Font Size', 'fontSize', s.fontSize, 8, 80, 1);
      html += `<div class="prop-row">
        <label>LaTeX</label>
        <button class="btn-primary btn-sm" id="btn-edit-formula">Edit Formula</button>
      </div>`;
    }

    // Transform Section
    html += `</div><div class="prop-section"><div class="prop-section-title">Transform</div>`;
    
    // Position / Size (except for lines which have separate X1/Y1/X2/Y2)
    if (s.type !== 'line') {
      html += this._numRow('X', 'x', Math.round(s.x), -9999, 9999, 1);
      html += this._numRow('Y', 'y', Math.round(s.y), -9999, 9999, 1);
      html += this._numRow('W', 'width',  Math.round(s.width),  1, 9999, 1);
      html += this._numRow('H', 'height', Math.round(s.height), 1, 9999, 1);
    }
    
    // Rotation applies to all shapes now
    const rotVal = s.type === 'line' ? Math.round(s.lineAngle ?? 0) : Math.round(s.rotation ?? 0);
    const rotProp = s.type === 'line' ? 'lineAngle' : 'rotation';
    html += this._numRow('Rotation', rotProp, rotVal, -360, 360, 1, '°');
    html += `</div>`;

    this.elShape.innerHTML = html;
    this._bindShapeEvents(shapes);
  }

  _bindShapeEvents(shapes) {
    const s = shapes[0];
    // Color swatches (Custom Picker)
    this.elShape.querySelectorAll('.color-swatch').forEach(btn => {
      btn.addEventListener('click', () => {
        const prop = btn.dataset.prop;
        const initialVal = shapes[0][prop];
        new ColorPicker(btn, initialVal, (newColor) => {
          shapes.forEach(sh => {
            sh[prop] = newColor; sh.render();
            this.app.setDefaultProp(sh.type, prop, newColor);
          });
          this.app.bus.emit(Events.SHAPE_UPDATED, {});
          
          const isTransparent = (!newColor || newColor === 'transparent' || newColor === 'none');
          const inner = btn.querySelector('.color-swatch-inner');
          if (inner) inner.style.backgroundColor = isTransparent ? '' : newColor;
          
          let noneLine = btn.querySelector('.color-swatch-none');
          if (isTransparent && !noneLine) {
            btn.insertAdjacentHTML('beforeend', '<div class="color-swatch-none"></div>');
          } else if (!isTransparent && noneLine) {
            noneLine.remove();
          }
        });
      });
    });
    // Number / range inputs
    this.elShape.querySelectorAll('input[type=number], input[type=range]').forEach(inp => {
      inp.addEventListener('focus', () => this._editing = true);
      inp.addEventListener('blur',  () => {
        this._editing = false;
        this.refresh();
      });
      inp.addEventListener('input', () => {
        const v = parseFloat(inp.value);
        if (isNaN(v)) return;
        shapes.forEach(sh => {
          sh[inp.dataset.prop] = v; sh.render();
          this.app.setDefaultProp(sh.type, inp.dataset.prop, v);
        });
        this.app.selection.refresh();
        this.app.bus.emit(Events.SHAPE_UPDATED, {});
      });
    });
    // Select inputs
    this.elShape.querySelectorAll('select').forEach(sel => {
      sel.addEventListener('change', () => {
        shapes.forEach(sh => {
          sh[sel.dataset.prop] = sel.value; sh.render();
          this.app.setDefaultProp(sh.type, sel.dataset.prop, sel.value);
        });
        this.app.selection.refresh();
        this.app.bus.emit(Events.SHAPE_UPDATED, {});
      });
    });
    // Checkbox inputs
    this.elShape.querySelectorAll('input[type=checkbox]').forEach(inp => {
      inp.addEventListener('change', () => {
        shapes.forEach(sh => {
          sh[inp.dataset.prop] = inp.checked; sh.render();
          this.app.setDefaultProp(sh.type, inp.dataset.prop, inp.checked);
        });
        this.app.selection.refresh();
        this.app.bus.emit(Events.SHAPE_UPDATED, {});
      });
    });
    // Toggle buttons
    this.elShape.querySelectorAll('.toggle-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const prop = btn.dataset.prop;
        const val  = btn.dataset.val;
        const off  = btn.dataset.off;
        shapes.forEach(sh => {
          const newVal = sh[prop] === val ? off : val;
          sh[prop] = newVal; sh.render();
          this.app.setDefaultProp(sh.type, prop, newVal);
        });
        this.app.bus.emit(Events.SHAPE_UPDATED, {});
        this._renderShapeSection();
      });
    });
    // Edit formula button
    const efBtn = this.elShape.querySelector('#btn-edit-formula');
    if (efBtn) efBtn.addEventListener('click', () => this.app.openFormulaEditor(s));
  }

  // ─── Row Helpers ──────────────────────────────────────────────────────────

  _colorRow(label, prop, value) {
    const isTransparent = (value === 'transparent' || value === 'none' || !value);
    const safe = isTransparent ? '#ffffff' : value;
    const innerStyle = isTransparent ? '' : `background-color: ${safe}`;
    const noneLine = isTransparent ? '<div class="color-swatch-none"></div>' : '';

    return `<div class="prop-row">
      <label>${label}</label>
      <div class="color-swatch" data-prop="${prop}" title="${label}">
        <div class="color-swatch-inner" style="${innerStyle}"></div>
        ${noneLine}
      </div>
    </div>`;
  }

  _numRow(label, prop, value, min, max, step, suffix = '') {
    return `<div class="prop-row">
      <label>${label}</label>
      <input type="number" data-prop="${prop}" value="${value}" min="${min}" max="${max}" step="${step}">
      ${suffix ? `<span class="prop-suffix">${suffix}</span>` : ''}
    </div>`;
  }

  _opacityRow(value) {
    return `<div class="prop-row">
      <label>Opacity</label>
      <input type="range" data-prop="opacity" value="${value}" min="0" max="1" step="0.05" style="flex:1">
      <span class="prop-suffix">${Math.round(value*100)}%</span>
    </div>`;
  }

  _selectRow(label, prop, value, options) {
    const opts = options.map(([v, t]) => `<option value="${v}"${v===value?' selected':''}>${t}</option>`).join('');
    return `<div class="prop-row">
      <label>${label}</label>
      <select data-prop="${prop}">${opts}</select>
    </div>`;
  }

  _checkboxRow(label, prop, value) {
    return `<div class="prop-row prop-checkbox" style="display: flex; align-items: center; gap: 8px;">
      <label>${label}</label>
      <input type="checkbox" data-prop="${prop}" ${value ? 'checked' : ''}>
    </div>`;
  }
}
