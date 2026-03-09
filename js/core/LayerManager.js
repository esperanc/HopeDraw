import { Events } from './Events.js';

let _layerCounter = 0;

export class LayerManager {
  constructor(bus) {
    this.bus = bus;
    this.layers = []; // [{ id, name, visible, locked, shapeIds[] }]
  }

  init() {
    this.addLayer('Layer 1');
  }

  addLayer(name) {
    const layer = {
      id: `layer-${Date.now()}-${_layerCounter++}`,
      name: name ?? `Layer ${this.layers.length + 1}`,
      visible: true,
      locked: false,
      shapeIds: [],
    };
    this.layers.unshift(layer); // new layers on top
    this.bus.emit(Events.LAYER_ADDED, { layer });
    return layer;
  }

  removeLayer(id) {
    const idx = this.layers.findIndex(l => l.id === id);
    if (idx === -1 || this.layers.length === 1) return null;
    const [removed] = this.layers.splice(idx, 1);
    this.bus.emit(Events.LAYER_REMOVED, { layer: removed });
    return removed;
  }

  getLayer(id) {
    return this.layers.find(l => l.id === id) ?? null;
  }

  getActiveLayer() {
    return this._active ? this.getLayer(this._active) : this.layers[0];
  }

  setActive(id) {
    this._active = id;
    this.bus.emit(Events.LAYER_UPDATED, {});
  }

  renameLayer(id, name) {
    const layer = this.getLayer(id);
    if (!layer) return;
    layer.name = name;
    this.bus.emit(Events.LAYER_UPDATED, { layer });
  }

  setVisible(id, visible) {
    const layer = this.getLayer(id);
    if (!layer) return;
    layer.visible = visible;
    this.bus.emit(Events.LAYER_UPDATED, { layer });
  }

  setLocked(id, locked) {
    const layer = this.getLayer(id);
    if (!layer) return;
    layer.locked = locked;
    this.bus.emit(Events.LAYER_UPDATED, { layer });
  }

  moveLayer(fromIdx, toIdx) {
    if (fromIdx === toIdx) return;
    const [item] = this.layers.splice(fromIdx, 1);
    this.layers.splice(toIdx, 0, item);
    this.bus.emit(Events.LAYER_REORDERED, { layers: this.layers });
  }

  addShapeToLayer(shapeId, layerId) {
    const layer = this.getLayer(layerId);
    if (!layer) return;
    if (!layer.shapeIds.includes(shapeId)) layer.shapeIds.push(shapeId);
  }

  removeShapeFromLayer(shapeId, layerId) {
    const layer = this.getLayer(layerId);
    if (!layer) return;
    layer.shapeIds = layer.shapeIds.filter(id => id !== shapeId);
  }

  /** Serialise all layers to plain objects */
  serialize() {
    return this.layers.map(l => ({ ...l, shapeIds: [...l.shapeIds] }));
  }

  /** Restore layers from plain objects */
  deserialize(data) {
    this.layers = data.map(l => ({ ...l, shapeIds: [...l.shapeIds] }));
    this.bus.emit(Events.LAYER_CHANGED, { layers: this.layers });
  }

  /** Return the z-ordered list of all visible shape IDs */
  get visibleShapeIds() {
    return this.layers
      .filter(l => l.visible)
      .flatMap(l => [...l.shapeIds]);
  }
}
