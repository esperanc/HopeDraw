import { Events } from '../core/Events.js';
import { RemoveShapesCommand } from '../core/CommandManager.js';
import { GroupShape } from '../shapes/GroupShape.js';
import { GroupCommand, UngroupCommand } from '../core/CommandManager.js';

export class ProjectMenu {
  constructor(app) {
    this.app = app;
    this._open = null; // currently open dropdown menu name

    app.bus.on(Events.PROJECT_SAVED,   ({ name }) => this._setTitle(name));
    app.bus.on(Events.PROJECT_LOADED,  ({ name }) => this._setTitle(name));
    app.bus.on(Events.PROJECT_NEW,     ({ name }) => this._setTitle(name));
    app.bus.on(Events.PROJECT_CHANGED, ({ name }) => this._setTitle((name ?? 'Untitled') + ' •'));
    app.bus.on(Events.HISTORY_CHANGED, (d) => {
      const btnU = document.getElementById('btn-undo');
      const btnR = document.getElementById('btn-redo');
      if (btnU) { btnU.disabled = !d.canUndo; btnU.title = d.undoLabel ? `Undo: ${d.undoLabel}` : 'Undo'; }
      if (btnR) { btnR.disabled = !d.canRedo; btnR.title = d.redoLabel ? `Redo: ${d.redoLabel}` : 'Redo'; }
    });
    app.bus.on(Events.ZOOM_CHANGED, ({ zoom }) => {
      const el = document.getElementById('zoom-display');
      if (el) el.textContent = Math.round(zoom * 100) + '%';
    });

    this._bindTopBar();
    this._bindMenuButtons();
    this._bindKeyboardShortcuts();
  }

  _setTitle(name) {
    const el = document.getElementById('project-title');
    if (el) el.textContent = name ?? 'Untitled';
  }

  _bindTopBar() {
    document.getElementById('btn-undo')?.addEventListener('click', () => this.app.commands.undo());
    document.getElementById('btn-redo')?.addEventListener('click', () => this.app.commands.redo());
    document.getElementById('btn-zoom-in')?.addEventListener('click',  () => this.app.canvas.zoomBy(1.2));
    document.getElementById('btn-zoom-out')?.addEventListener('click', () => this.app.canvas.zoomBy(1/1.2));

    // Support cross-instance paste button enabling
    window.addEventListener('storage', (e) => {
      if (e.key === 'hopedraw_clipboard') {
        // Redraw open edit menu if visible to update Paste's disabled state
        if (this._open === 'edit') this._openDropdown('edit', document.querySelector('[data-menu="edit"]'));
      }
    });

    // Click outside to close dropdown
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.menu-btn') && !e.target.closest('#dropdown-menu')) {
        this._closeDropdown();
      }
    });
  }

  _bindMenuButtons() {
    document.querySelectorAll('.menu-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const menuName = btn.dataset.menu;
        if (this._open === menuName) { this._closeDropdown(); return; }
        this._openDropdown(menuName, btn);
      });
    });
  }

  _openDropdown(name, anchorEl) {
    this._open = name;
    const dd = document.getElementById('dropdown-menu');
    const items = this._menuItems(name);
    dd.innerHTML = items.map(item => {
      if (item === '---') return `<div class="dd-sep"></div>`;
      return `<button class="dd-item" data-action="${item.action}" ${item.disabled?'disabled':''}>
        <span class="dd-label">${item.label}</span>
        ${item.shortcut ? `<span class="dd-shortcut">${item.shortcut}</span>` : ''}
      </button>`;
    }).join('');
    dd.style.display = 'block';
    const rect = anchorEl.getBoundingClientRect();
    dd.style.left = rect.left + 'px';
    dd.style.top  = rect.bottom + 'px';
    document.querySelectorAll('.menu-btn').forEach(b => b.classList.remove('active'));
    anchorEl.classList.add('active');

    dd.querySelectorAll('.dd-item').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.action;
        this._closeDropdown();
        // File downloads MUST happen within the same synchronous user-gesture
        // scope as the click — setTimeout would break the trust chain and cause
        // browsers to silently block the programmatic anchor click.
        if (action === 'file-export-svg') {
          this._runAction(action);
        } else {
          setTimeout(() => this._runAction(action), 10);
        }
      });
    });
  }

  _closeDropdown() {
    this._open = null;
    document.getElementById('dropdown-menu').style.display = 'none';
    document.querySelectorAll('.menu-btn').forEach(b => b.classList.remove('active'));
  }

  _menuItems(name) {
    const app = this.app;
    const hasSel = !app.selection.isEmpty;
    const canUndo = app.commands.canUndo();
    const canRedo = app.commands.canRedo();
    switch(name) {
      case 'file': return [
        { label: 'New Project',   action: 'file-new',    shortcut: 'Ctrl+N' },
        { label: 'Open Project…', action: 'file-open',   shortcut: 'Ctrl+O' },
        '---',
        { label: 'Save',          action: 'file-save',   shortcut: 'Ctrl+S' },
        { label: 'Save As…',      action: 'file-save-as'},
        { label: 'Rename…',       action: 'file-rename' },
        '---',
        { label: 'Export SVG',    action: 'file-export-svg', shortcut: 'Ctrl+E' },
        { label: 'Import SVG…',   action: 'file-import-svg' },
      ];
      case 'edit': return [
        { label: 'Undo',          action: 'edit-undo',   shortcut: 'Ctrl+Z', disabled: !canUndo },
        { label: 'Redo',          action: 'edit-redo',   shortcut: 'Ctrl+Y', disabled: !canRedo },
        '---',
        { label: 'Cut',           action: 'edit-cut',    shortcut: 'Ctrl+X', disabled: !hasSel },
        { label: 'Copy',          action: 'edit-copy',   shortcut: 'Ctrl+C', disabled: !hasSel },
        { label: 'Paste',         action: 'edit-paste',  shortcut: 'Ctrl+V', disabled: !this._hasClipboard() },
        '---',
        { label: 'Select All',    action: 'edit-select-all', shortcut: 'Ctrl+A' },
        { label: 'Delete',        action: 'edit-delete', shortcut: 'Del',    disabled: !hasSel },
        '---',
        { label: 'Group',         action: 'edit-group',  shortcut: 'Ctrl+G', disabled: app.selection.count < 2 },
        { label: 'Ungroup',       action: 'edit-ungroup',shortcut: 'Ctrl+⇧+G', disabled: !hasSel },
      ];
      case 'view': return [
        { label: 'Zoom In',       action: 'view-zoom-in',  shortcut: '+' },
        { label: 'Zoom Out',      action: 'view-zoom-out', shortcut: '-' },
        { label: 'Fit to Screen', action: 'view-fit' },
        { label: 'Reset Zoom',    action: 'view-zoom-reset', shortcut: '0' },
        '---',
        { label: 'Toggle Grid',   action: 'view-grid',     shortcut: 'Ctrl+\'' },
        { label: 'Snap to Grid',  action: 'view-snap',     shortcut: 'Ctrl+Shift+;' },
      ];
      case 'arrange': return [
        { label: 'Bring to Front',  action: 'arr-front', disabled: !hasSel },
        { label: 'Send to Back',    action: 'arr-back',  disabled: !hasSel },
        { label: 'Bring Forward',   action: 'arr-fwd',   disabled: !hasSel },
        { label: 'Send Backward',   action: 'arr-bwd',   disabled: !hasSel },
      ];
      default: return [];
    }
  }

  _hasClipboard() {
    try {
      return !!this.app._clipboard?.length || !!localStorage.getItem('hopedraw_clipboard');
    } catch { return !!this.app._clipboard?.length; }
  }

  _runAction(action) {
    const app = this.app;
    switch(action) {
      case 'file-new':        this._doNewProject(); break;
      case 'file-open':       this._doOpenProject(); break;
      case 'file-save':       this._doSave(); break;
      case 'file-save-as':    this._doSaveAs(); break;
      case 'file-rename':     this._doRename(); break;
      case 'file-export-svg': app.projects.exportSVG(); break;
      case 'file-import-svg': this._doImportSVG(); break;
      case 'edit-undo':       app.commands.undo(); break;
      case 'edit-redo':       app.commands.redo(); break;
      case 'edit-cut':        app.cut(); break;
      case 'edit-copy':       app.copy(); break;
      case 'edit-paste':      app.paste(); break;
      case 'edit-select-all': this._doSelectAll(); break;
      case 'edit-delete':     this._doDelete(); break;
      case 'edit-group':      this._doGroup(); break;
      case 'edit-ungroup':    this._doUngroup(); break;
      case 'view-zoom-in':    app.canvas.zoomBy(1.2); break;
      case 'view-zoom-out':   app.canvas.zoomBy(1/1.2); break;
      case 'view-zoom-reset': app.canvas.resetView(); break;
      case 'view-fit':        app.canvas.resetView(); break;
      case 'view-grid':       app.canvas.toggleGrid(); break;
      case 'view-snap':       app.canvas.toggleSnap(); break;
      case 'arr-front': this._reorder('front'); break;
      case 'arr-back':  this._reorder('back');  break;
      case 'arr-fwd':   this._reorder('fwd');   break;
      case 'arr-bwd':   this._reorder('bwd');   break;
    }
  }

  // ─── Actions ───────────────────────────────────────────────────────────────

  _doNewProject() {
    const proceed = () => {
      this._showInputModal('New Project', 'Untitled', (name) => {
        this.app.projects.newProject(name);
      });
    };
    if (this.app.projects.dirty) {
      this._showConfirmModal('Unsaved changes', 'Discard unsaved changes?', proceed);
    } else {
      proceed();
    }
  }

  _doOpenProject() {
    const projects = this.app.projects.listProjects();
    if (!projects.length) { this._showAlertModal('Open Project', 'No saved projects.'); return; }
    this._showModal('Open Project', `
      <ul class="project-list">
        ${projects.map(n => `<li><button class="project-item" data-name="${n}">${n}</button></li>`).join('')}
      </ul>`, []);
    document.querySelectorAll('.project-item').forEach(btn => {
      btn.addEventListener('click', () => {
        this.app.projects.load(btn.dataset.name);
        this._closeModal();
      });
    });
  }

  _doSave() {
    if (this.app.projects.currentName) {
      this.app.projects.save();
    } else {
      this._doSaveAs();
    }
  }

  _doSaveAs() {
    this._showInputModal('Save as:', this.app.projects.currentName ?? 'Untitled', (name) => {
      this.app.projects.save(name);
    });
  }

  _doRename() {
    const current = this.app.projects.currentName ?? '';
    this._showInputModal('Rename project:', current, (name) => {
      if (name && name !== current) this.app.projects.rename(name);
    });
  }

  _doImportSVG() {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.svg,image/svg+xml';
    inp.addEventListener('change', async () => {
      const file = inp.files[0];
      if (!file) return;
      const text = await file.text();
      await this.app.projects.importSVG(text);
    });
    inp.click();
  }

  _doSelectAll() {
    const ids = [...this.app.shapes.keys()];
    if (ids.length) this.app.selection.selectMany(ids);
  }

  _doDelete() {
    const shapes = this.app.selection.selectedShapes();
    if (!shapes.length) return;
    this.app.commands.execute(new RemoveShapesCommand(this.app, shapes));
    this.app.selection.clear();
  }

  _doGroup() {
    const shapes = this.app.selection.selectedShapes();
    if (shapes.length < 2) return;
    const layerId = this.app.layers.getActiveLayer()?.id ?? shapes[0].layerId;
    const group = new GroupShape({ layerId }, shapes);
    this.app.commands.execute(new GroupCommand(this.app, group, shapes));
    this.app.selection.select(group.id);
  }

  _doUngroup() {
    const shapes = this.app.selection.selectedShapes();
    shapes.forEach(s => {
      if (s.type !== 'group') return;
      const children = s.children;
      this.app.commands.execute(new UngroupCommand(this.app, s, children));
      this.app.selection.selectMany(children.map(c => c.id));
    });
  }

  _reorder(dir) {
    const shapes = this.app.selection.selectedShapes();
    if (!shapes.length) return;
    const s = shapes[0];
    const layer = this.app.layers.getLayer(s.layerId);
    if (!layer) return;
    const ids = layer.shapeIds;
    const idx = ids.indexOf(s.id);
    if (idx === -1) return;
    if ((dir === 'front' || dir === 'fwd') && idx < ids.length - 1) {
      const newIdx = dir === 'front' ? ids.length - 1 : idx + 1;
      ids.splice(idx, 1); ids.splice(newIdx, 0, s.id);
      // Reorder DOM
      s.el?.parentNode?.appendChild(s.el);
    } else if ((dir === 'back' || dir === 'bwd') && idx > 0) {
      const newIdx = dir === 'back' ? 0 : idx - 1;
      ids.splice(idx, 1); ids.splice(newIdx, 0, s.id);
      const parent = s.el?.parentNode;
      if (parent) parent.insertBefore(s.el, parent.children[newIdx]);
    }
  }

  _showAlertModal(title, text) {
    this._showModal(title, `<p style="margin-top:10px; color:#ccc">${text}</p>`, [
      { id: 'ok', label: 'OK', style: 'primary' }
    ]);
    document.getElementById('modal-btn-ok').addEventListener('click', () => this._closeModal());
  }

  _showConfirmModal(title, text, onConfirm) {
    this._showModal(title, `<p style="margin-top:10px; color:#ccc">${text}</p>`, [
      { id: 'cancel', label: 'Cancel', style: 'secondary' },
      { id: 'yes', label: 'Yes', style: 'primary' }
    ]);
    document.getElementById('modal-btn-yes').addEventListener('click', () => {
      this._closeModal();
      onConfirm();
    });
    document.getElementById('modal-btn-cancel').addEventListener('click', () => this._closeModal());
  }

  _showInputModal(title, defaultValue, onConfirm) {
    const inputId = 'modal-input-' + Math.random().toString(36).substr(2, 9);
    this._showModal(title, `
      <input type="text" id="${inputId}" value="${defaultValue}" autocomplete="off" 
             style="width:100%; padding:0.6rem; margin-top:15px; background:#1c1e26; color:#fff; border:1px solid #333; border-radius:4px; font-size:14px; outline:none;" />
    `, [
      { id: 'cancel', label: 'Cancel', style: 'secondary' },
      { id: 'ok', label: 'OK', style: 'primary' }
    ]);
    
    // Defer focus slightly to let DOM render
    setTimeout(() => {
      const inp = document.getElementById(inputId);
      if (inp) {
        inp.focus();
        inp.select();
        inp.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            document.getElementById('modal-btn-ok').click();
          }
        });
      }
    }, 10);

    document.getElementById('modal-btn-ok').addEventListener('click', () => {
      const val = document.getElementById(inputId).value.trim();
      if (val) onConfirm(val);
      this._closeModal();
    });
    document.getElementById('modal-btn-cancel').addEventListener('click', () => this._closeModal());
  }

  _showModal(title, body, buttons) {
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-body').innerHTML = body;
    document.getElementById('modal-actions').innerHTML =
      buttons.map(b => `<button class="btn-${b.style ?? 'secondary'}" id="modal-btn-${b.id}">${b.label}</button>`).join('');
    document.getElementById('modal-overlay').style.display = 'flex';
    document.getElementById('modal-overlay').addEventListener('click', (e) => {
      if (e.target.id === 'modal-overlay') this._closeModal();
    }, { once: true });
  }

  _closeModal() {
    document.getElementById('modal-overlay').style.display = 'none';
  }

  _bindKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      if (document.activeElement?.contentEditable === 'true') return;
      if (document.activeElement?.tagName === 'INPUT' ||
          document.activeElement?.tagName === 'TEXTAREA') return;
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key === 'z') { e.preventDefault(); this.app.commands.undo(); }
      else if (ctrl && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) { e.preventDefault(); this.app.commands.redo(); }
      else if (ctrl && e.key === 's') { e.preventDefault(); this._doSave(); }
      else if (ctrl && e.key === 'e') { e.preventDefault(); this.app.projects.exportSVG(); }
      else if (ctrl && e.key === 'c') { e.preventDefault(); this.app.copy(); }
      else if (ctrl && e.key === 'x') { e.preventDefault(); this.app.cut(); }
      else if (ctrl && e.key === 'v') { e.preventDefault(); this.app.paste(); }
      else if (ctrl && e.key === 'a') { e.preventDefault(); this._doSelectAll(); }
      else if (ctrl && e.key === 'g') { e.preventDefault(); e.shiftKey ? this._doUngroup() : this._doGroup(); }
      else if (ctrl && e.key === '\'') { e.preventDefault(); this.app.canvas.toggleGrid(); }
      else if (e.key === '0' && ctrl) { this.app.canvas.resetView(); }
      else if (e.key === 'v' || e.key === 'V') this.app.setActiveTool('select');
      else if (e.key === 'r' || e.key === 'R') this.app.setActiveTool('rect');
      else if (e.key === 'e' || e.key === 'E') this.app.setActiveTool('ellipse');
      else if (e.key === 'l' || e.key === 'L') this.app.setActiveTool('line');
      else if (e.key === 't' || e.key === 'T') this.app.setActiveTool('text');
      else if (e.key === 'p' || e.key === 'P') this.app.setActiveTool('parallelogram');
      else if (e.key === 'f' || e.key === 'F') this.app.setActiveTool('formula');
      // Tool's key handler
      this.app._activeTool?.onKeyDown?.(e);
    });
  }
}
