import { Events } from '../core/Events.js';

export class LayersPanel {
  constructor(app) {
    this.app  = app;
    this.list = document.getElementById('layers-list');
    this._dragging = null;

    app.bus.on(Events.LAYER_ADDED,    () => this.render());
    app.bus.on(Events.LAYER_REMOVED,  () => this.render());
    app.bus.on(Events.LAYER_UPDATED,  () => this.render());
    app.bus.on(Events.LAYER_REORDERED,() => this.render());
    app.bus.on(Events.PROJECT_LOADED, () => this.render());
    app.bus.on(Events.PROJECT_NEW,    () => this.render());

    document.getElementById('btn-add-layer')?.addEventListener('click', () => {
      app.layers.addLayer();
    });
  }

  render() {
    const { layers, layers: mgr } = this.app;
    const layerList = mgr.layers;
    const activeLyr = mgr.getActiveLayer();

    this.list.innerHTML = layerList.map((layer, idx) => `
      <div class="layer-row${layer.id === activeLyr?.id ? ' active' : ''}"
           data-layer-id="${layer.id}" data-idx="${idx}" draggable="true">
        <span class="layer-drag-handle" title="Drag to reorder">⠿</span>
        <button class="layer-icon-btn layer-vis" data-id="${layer.id}" title="${layer.visible ? 'Hide' : 'Show'}">
          ${layer.visible ? '👁' : '🙈'}
        </button>
        <button class="layer-icon-btn layer-lock" data-id="${layer.id}" title="${layer.locked ? 'Unlock' : 'Lock'}">
          ${layer.locked ? '🔒' : '🔓'}
        </button>
        <span class="layer-name" contenteditable="true" data-id="${layer.id}">${layer.name}</span>
        <span class="layer-count">${layer.shapeIds.length}</span>
        <button class="layer-icon-btn layer-del" data-id="${layer.id}" title="Delete layer">✕</button>
      </div>
    `).join('');

    // Events
    this.list.querySelectorAll('.layer-row').forEach(row => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('button, [contenteditable]')) return;
        this.app.layers.setActive(row.dataset.layerId);
        this.render();
      });
      row.addEventListener('dragstart', (e) => {
        this._dragging = parseInt(row.dataset.idx);
        e.dataTransfer.effectAllowed = 'move';
      });
      row.addEventListener('dragover', (e) => { e.preventDefault(); });
      row.addEventListener('drop', (e) => {
        const toIdx = parseInt(row.dataset.idx);
        if (this._dragging !== null && this._dragging !== toIdx)
          this.app.layers.moveLayer(this._dragging, toIdx);
        this._dragging = null;
      });
    });
    this.list.querySelectorAll('.layer-vis').forEach(btn => {
      btn.addEventListener('click', () => {
        const l = this.app.layers.getLayer(btn.dataset.id);
        if (l) this.app.layers.setVisible(l.id, !l.visible);
        // Toggle all shapes in that layer
        const shapes = (l?.shapeIds ?? []).map(id => this.app.shapes.get(id)).filter(Boolean);
        shapes.forEach(s => { if (s.el) s.el.style.display = l?.visible ? '' : 'none'; });
      });
    });
    this.list.querySelectorAll('.layer-lock').forEach(btn => {
      btn.addEventListener('click', () => {
        const l = this.app.layers.getLayer(btn.dataset.id);
        if (l) this.app.layers.setLocked(l.id, !l.locked);
      });
    });
    this.list.querySelectorAll('.layer-del').forEach(btn => {
      btn.addEventListener('click', () => {
        const l = this.app.layers.getLayer(btn.dataset.id);
        if (!l) return;
        if (!confirm(`Delete layer "${l.name}"? Shapes on this layer will also be deleted.`)) return;
        // Remove all shapes on the layer
        l.shapeIds.slice().forEach(id => {
          const s = this.app.shapes.get(id);
          if (s) { s.unmount(); this.app.shapes.delete(id); }
        });
        this.app.layers.removeLayer(l.id);
        this.app.selection.clear();
      });
    });
    this.list.querySelectorAll('.layer-name[contenteditable]').forEach(span => {
      span.addEventListener('blur', () => {
        this.app.layers.renameLayer(span.dataset.id, span.textContent.trim());
      });
      span.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); span.blur(); }
      });
    });
  }
}
